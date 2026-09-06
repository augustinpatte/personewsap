import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static contract checks on the Teams migrations.
 *
 * These are not a substitute for running the SQL — `npm run teams:test:sql --
 * --with-migrations` does that, inside a transaction it rolls back. They exist
 * because that run needs a Supabase access token and a network, and these
 * invariants are exactly the ones that are cheap to break in an edit and
 * expensive to discover in production:
 *
 *   * a new table shipped without RLS enabled;
 *   * a SECURITY DEFINER function without a pinned search_path, or still
 *     executable by PUBLIC;
 *   * a write privilege handed to `authenticated` on a scoring table;
 *   * anything at all granted to `anon`;
 *   * the private grading schema leaking into a GRANT;
 *   * and the 42702 trap this repository has already been bitten by once —
 *     an unqualified reference, inside a PL/pgSQL body, to a column name that
 *     is also a RETURNS TABLE output (see
 *     20260904120000_fix_update_profile_language_ambiguity).
 */

const root = join(__dirname, "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

const MIGRATIONS = [
  "20260906090000_edition_registry.sql",
  "20260906091000_player_identity.sql",
  "20260906092000_teams_foundation.sql",
  "20260906093000_scored_questions.sql",
  "20260906094000_question_attempts_and_scoring.sql",
  "20260906095000_realtime_and_moderation.sql"
] as const;

const sources = new Map(
  MIGRATIONS.map((name) => [name, readFileSync(join(migrationsDir, name), "utf8")])
);

const all = [...sources.values()].join("\n");

/** SQL with comments and string literals removed, so prose is never a finding. */
function stripNoise(sql: string): string {
  return sql
    .replace(/^\s*--.*$/gm, "")
    .replace(/'(?:[^']|'')*'/g, "''");
}

const allCode = stripNoise(all);

/** Tables created across the whole set, as `public.x` / `private.x`. */
function createdTables(sql: string): string[] {
  return [
    ...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+((?:public|private)\.\w+)/gi)
  ].map((match) => match[1]);
}

/** Every function definition, with its header and body. */
type FunctionDefinition = {
  name: string;
  header: string;
  body: string;
  isDefiner: boolean;
  isPlpgsql: boolean;
  returnsTableColumns: string[];
};

function functionDefinitions(sql: string): FunctionDefinition[] {
  const definitions: FunctionDefinition[] = [];
  const pattern = /CREATE OR REPLACE FUNCTION\s+((?:public|private)\.\w+)\s*\(/gi;

  for (const match of sql.matchAll(pattern)) {
    const start = match.index ?? 0;
    // The body is delimited by a dollar-quoted string; find the tag that opens
    // it and read to its matching close.
    const afterHeader = sql.slice(start);
    const openTag = /\n\s*AS\s+(\$\w*\$)/i.exec(afterHeader);

    if (!openTag) {
      continue;
    }

    const tag = openTag[1];
    const bodyStart = (openTag.index ?? 0) + openTag[0].length;
    const bodyEnd = afterHeader.indexOf(tag, bodyStart);
    const header = afterHeader.slice(0, openTag.index ?? 0);
    const body = bodyEnd === -1 ? "" : afterHeader.slice(bodyStart, bodyEnd);

    const returnsTable = /RETURNS TABLE\s*\(([\s\S]*?)\)\s*\n\s*LANGUAGE/i.exec(header);
    const returnsTableColumns = returnsTable
      ? returnsTable[1]
          .split(",")
          .map((entry) => entry.trim().split(/\s+/)[0])
          .filter((name) => /^\w+$/.test(name))
      : [];

    definitions.push({
      name: match[1],
      header,
      body,
      isDefiner: /SECURITY DEFINER/i.test(header),
      isPlpgsql: /LANGUAGE\s+plpgsql/i.test(header),
      returnsTableColumns
    });
  }

  return definitions;
}

const functions = functionDefinitions(allCode);

describe("the migration files themselves", () => {
  it("are each a single explicit transaction", () => {
    for (const [name, sql] of sources) {
      const code = stripNoise(sql);

      expect((code.match(/^\s*BEGIN;/gim) ?? []).length, name).toBe(1);
      expect((code.match(/^\s*COMMIT;/gim) ?? []).length, name).toBe(1);
      // A failed migration must leave nothing half-applied.
      expect(code.indexOf("BEGIN;"), name).toBeLessThan(code.indexOf("COMMIT;"));
    }
  });

  it("close every dollar-quoted block they open", () => {
    for (const [name, sql] of sources) {
      const tags = [...sql.matchAll(/\$(\w*)\$/g)].map((match) => match[0]);
      const counts = new Map<string, number>();

      for (const tag of tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }

      for (const [tag, count] of counts) {
        expect(count % 2, `${name} has an odd number of ${tag}`).toBe(0);
      }
    }
  });

  it("never drop or rename anything that already existed", () => {
    // The whole set is meant to be additive. DROP POLICY on a policy this set
    // creates is fine (re-runnability); anything else is not.
    const drops = [...allCode.matchAll(/DROP\s+(TABLE|COLUMN|CONSTRAINT|FUNCTION|SCHEMA|TYPE)/gi)];

    expect(drops.map((match) => match[0])).toEqual([]);
    expect(allCode).not.toMatch(/ALTER TABLE[\s\S]{0,80}\bRENAME\b/i);
    expect(allCode).not.toMatch(/ALTER TABLE[\s\S]{0,80}\bDROP COLUMN\b/i);
  });

  it("only ever add columns to existing tables", () => {
    for (const match of allCode.matchAll(/ALTER TABLE\s+public\.(\w+)([\s\S]*?);/gi)) {
      const [statement, table] = [match[0], match[1]];

      // Tables this set creates are its own business.
      if (createdTables(allCode).includes(`public.${table}`)) {
        continue;
      }

      expect(
        /ADD COLUMN IF NOT EXISTS|ADD CONSTRAINT|ENABLE ROW LEVEL SECURITY/i.test(statement),
        `${table}: ${statement.slice(0, 120)}`
      ).toBe(true);
    }
  });
});

describe("row level security", () => {
  it("is enabled on every table these migrations create", () => {
    for (const table of createdTables(allCode)) {
      expect(allCode, table).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("covers the tables the feature depends on", () => {
    // Named explicitly as well, so deleting a CREATE TABLE cannot quietly
    // shrink the list the loop above iterates.
    for (const table of [
      "public.editions",
      "public.teams",
      "public.team_members",
      "public.team_config_versions",
      "public.logical_questions",
      "public.logical_question_options",
      "public.logical_question_locales",
      "public.logical_question_option_locales",
      "public.solo_question_assignments",
      "public.team_question_assignments",
      "public.question_attempts",
      "public.team_question_scores",
      "public.team_member_edition_scores",
      "public.user_blocks",
      "public.user_reports",
      "private.logical_question_grades",
      "private.logical_question_option_feedback"
    ]) {
      expect(allCode, table).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
  });
});

describe("privileges", () => {
  it("grant nothing to anon, anywhere", () => {
    const grantsToAnon = [...allCode.matchAll(/GRANT[^;]*?\bTO\b[^;]*?\banon\b/gi)];

    expect(grantsToAnon.map((match) => match[0].replace(/\s+/g, " "))).toEqual([]);
  });

  it("never grant a client role anything in the private schema", () => {
    for (const match of allCode.matchAll(/GRANT[^;]*private\.[^;]*;/gi)) {
      expect(match[0], match[0]).not.toMatch(/\b(anon|authenticated)\b/);
    }

    expect(allCode).toContain("REVOKE ALL ON SCHEMA private FROM authenticated");
    expect(allCode).toContain("REVOKE ALL ON SCHEMA private FROM anon");
  });

  it("give authenticated no write on any scoring or question table", () => {
    // The security model in one assertion: a client can read the game and can
    // never write it. Everything that changes a score goes through an RPC.
    const readOnlyForClients = [
      "public.editions",
      "public.teams",
      "public.team_members",
      "public.team_config_versions",
      "public.team_config_newsletter_topics",
      "public.team_config_mini_case_topics",
      "public.logical_questions",
      "public.logical_question_options",
      "public.logical_question_locales",
      "public.logical_question_option_locales",
      "public.solo_question_assignments",
      "public.team_question_assignments",
      "public.question_attempts",
      "public.team_question_scores",
      "public.team_member_edition_scores"
    ];

    for (const table of readOnlyForClients) {
      for (const match of allCode.matchAll(
        new RegExp(`GRANT ([^;]*?) ON TABLE ${table.replace(".", "\\.")} TO ([^;]*?);`, "gi")
      )) {
        const [, privileges, roles] = match;

        if (/\bauthenticated\b/.test(roles)) {
          expect(privileges.trim().toUpperCase(), `${table}: ${match[0]}`).toBe("SELECT");
        }
      }
    }
  });

  it("leave no write policy on the scoring tables", () => {
    for (const table of [
      "public.question_attempts",
      "public.team_question_scores",
      "public.team_member_edition_scores",
      "public.logical_questions",
      "public.logical_question_options",
      "public.team_question_assignments",
      "public.solo_question_assignments"
    ]) {
      const policies = [
        ...allCode.matchAll(
          new RegExp(`CREATE POLICY[^;]*?ON ${table.replace(".", "\\.")}[^;]*?FOR (\\w+)`, "gi")
        )
      ].map((match) => match[1].toUpperCase());

      expect(policies.filter((verb) => verb !== "SELECT"), table).toEqual([]);
    }
  });
});

describe("SECURITY DEFINER functions", () => {
  const definers = functions.filter((definition) => definition.isDefiner);

  it("exist and are the only way scores are written", () => {
    expect(definers.length).toBeGreaterThan(10);
  });

  it("all pin a search_path", () => {
    // Without this a definer function resolves unqualified names through the
    // caller's search_path, which is the classic definer privilege escalation.
    for (const definition of definers) {
      expect(definition.header, definition.name).toMatch(
        /SET search_path\s*=\s*public,\s*pg_temp/i
      );
    }
  });

  it("all have EXECUTE revoked from PUBLIC", () => {
    for (const definition of definers) {
      const escaped = definition.name.replace(".", "\\.");

      expect(
        new RegExp(`REVOKE ALL ON FUNCTION ${escaped}\\([^)]*\\) FROM PUBLIC`, "i").test(allCode),
        `${definition.name} is SECURITY DEFINER without REVOKE ... FROM PUBLIC`
      ).toBe(true);
    }
  });

  it("keep the server-only ones away from authenticated", () => {
    // These write scores, register editions or moderate. A client key must not
    // be able to call any of them.
    for (const name of [
      "public.register_edition",
      "public.refresh_team_member_edition_score",
      "public.broadcast_team_leaderboard_change",
      "public.teams_scoring_question",
      "public.moderate_player_identity",
      "public.moderate_team_name",
      "public.generate_team_invite_code"
    ]) {
      const escaped = name.replace(".", "\\.");

      expect(
        new RegExp(`REVOKE ALL ON FUNCTION ${escaped}\\([^)]*\\) FROM authenticated`, "i").test(
          allCode
        ),
        `${name} must be revoked from authenticated`
      ).toBe(true);
    }
  });

  it("never take a user id where they should read auth.uid()", () => {
    // A function that trusted a caller-supplied user id would let any signed-in
    // reader act as anybody. The exceptions are the two server-only functions
    // whose whole job is to answer about somebody else, plus the read-only
    // predicates the leaderboard needs.
    const allowed = new Set([
      "public.teams_scoring_question",
      "public.refresh_team_member_edition_score",
      "public.was_team_member_eligible_for_edition",
      "public.team_member_edition_streak",
      "public.moderate_player_identity",
      "public.shares_active_team_with",
      "public.broadcast_team_leaderboard_change"
    ]);

    for (const definition of definers) {
      if (allowed.has(definition.name)) {
        continue;
      }

      expect(definition.header, `${definition.name} takes a user id parameter`).not.toMatch(
        /p_user_id\s+UUID/i
      );
    }
  });
});

describe("the 42702 trap", () => {
  // Every output column of a RETURNS TABLE is also a PL/pgSQL variable. An
  // unqualified reference to a column of the same name inside the body raises
  // "column reference is ambiguous" at plan time — on every call. That is the
  // exact bug that broke the language switch for every reader
  // (20260904120000), so it is checked mechanically rather than by discipline.
  const risky = functions.filter(
    (definition) => definition.isPlpgsql && definition.returnsTableColumns.length > 0
  );

  it("finds the functions worth checking", () => {
    expect(risky.length).toBeGreaterThan(5);
  });

  it.each(risky.map((definition) => [definition.name, definition] as const))(
    "%s qualifies every reference to its own output column names",
    (name, definition) => {
      for (const column of definition.returnsTableColumns) {
        // Positions where a bare column name is unambiguous to the parser and
        // never variable-substituted: an INSERT column list, an ON CONFLICT
        // target, and the left-hand side of a SET. Everything else must be
        // written as alias.column.
        const body = definition.body
          .replace(/INSERT INTO[\s\S]*?\)\s*(?=VALUES|SELECT|ON CONFLICT)/gi, " ")
          .replace(/ON CONFLICT\s*\([^)]*\)/gi, " ")
          .replace(/\bSET\b[\s\S]*?(?=\bWHERE\b|\bRETURNING\b|;)/gi, " ")
          .replace(/RETURNS TABLE\s*\([^)]*\)/gi, " ");

        // A bare `column` not preceded by `something.` and not part of a longer
        // identifier.
        const bare = new RegExp(`(?<![\\w.])${column}(?![\\w])`, "gi");
        const hits = [...body.matchAll(bare)];

        expect(
          hits.length,
          `${name}: unqualified "${column}" in the body (also a RETURNS TABLE output)`
        ).toBe(0);
      }
    }
  );
});

describe("the product rules that must not be re-litigated in code", () => {
  it("keeps Business Stories out of Teams by referential constraint", () => {
    expect(allCode).toMatch(
      /team_question_assignments_no_business_story_check[\s\S]*?content_type IN \(\s*''\s*,\s*''\s*\)/i
    );
    expect(allCode).toContain("team_question_assignments_question_fkey");
  });

  it("pins the mini-case pedagogical order to the question sequence", () => {
    expect(all).toContain("method_framework");
    expect(all).toContain("technical_application");
    expect(all).toContain("conclusion_decision");
    expect(allCode).toMatch(/question_role = \(ARRAY\[[\s\S]*?\]\)\[question_sequence\]/i);
  });

  it("gives one attempt per reader per LOGICAL question", () => {
    expect(allCode).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS question_attempts_user_question_unique\s*\n?\s*ON public\.question_attempts \(user_id, logical_question_id\)/i
    );
  });

  it("scores only against the private answer key and the server clock", () => {
    const submit = functions.find((definition) => definition.name === "public.submit_question_answer");

    expect(submit).toBeDefined();
    // No score parameter, ever.
    expect(submit?.header).not.toMatch(/p_score/i);
    // The deadline comparison uses now(), not anything the caller sent.
    expect(submit?.body).toMatch(/v_now\s*>\s*v_attempt\.deadline_at/);
    expect(submit?.body).toContain("private.logical_question_grades");
  });

  it("holds the 20-second limit and the 0/300/600/1000 scale in the schema", () => {
    expect(allCode).toMatch(/time_limit_seconds SMALLINT NOT NULL DEFAULT 20/i);
    expect(allCode).toMatch(/score_milli IN \(0, 300, 600, 1000\)/);
    expect(allCode).toMatch(/grade_band IN \(''\s*,\s*''\s*,\s*''\s*,\s*''\)/);
  });

  it("uses editions, never a device calendar day, as the unit of time", () => {
    // A local-midnight boundary is the timezone bug the reader edition date fix
    // already removed; reintroducing it for scoring would give two members of
    // one team different deadlines.
    expect(allCode).not.toMatch(/CURRENT_DATE\s*[-+]/);
    expect(allCode).toContain("public.is_edition_open");
    expect(allCode).toContain("public.next_scoring_edition_date");
  });

  it("keeps team assignments out of daily_drop_items", () => {
    expect(allCode).not.toMatch(/INSERT INTO public\.daily_drop_items/i);
    expect(allCode).not.toMatch(/UPDATE public\.daily_drop_items/i);
  });

  it("does not touch the systems this pass was told to leave alone", () => {
    for (const forbidden of [
      "push_tokens",
      "push_notification_deliveries",
      "learning_sessions",
      "user_learning_paths",
      "update_profile_language",
      "user_archive_search_items",
      "publish_scheduled_staging_payload"
    ]) {
      expect(allCode, forbidden).not.toContain(forbidden);
    }
  });
});

describe("the SQL suite itself", () => {
  const suite = readFileSync(
    join(root, "supabase", "tests", "teams_and_scored_questions.test.sql"),
    "utf8"
  );

  it("is one transaction that always rolls back", () => {
    // The suite creates readers, teams and attempts in a live database. The
    // ROLLBACK is what makes that safe, so its presence is not left to review.
    expect((suite.match(/^begin;/gim) ?? []).length).toBe(1);
    expect((suite.match(/^rollback;/gim) ?? []).length).toBe(1);
    expect(suite.trimEnd().endsWith("rollback;")).toBe(true);
    expect(suite).not.toMatch(/^commit;/im);
  });

  it("closes every block it opens", () => {
    expect((suite.match(/\$\$/g) ?? []).length % 2).toBe(0);
    expect((suite.match(/^do \$\$/gim) ?? []).length).toBeGreaterThan(0);
    expect((suite.match(/set local role/gi) ?? []).length).toBe(
      (suite.match(/^reset role;/gim) ?? []).length
    );
  });

  it("derives its edition dates from now() instead of pinning them", () => {
    // A fixture pinned to a future date leaves the real most-recent production
    // edition as "current", and every ordering assertion then tests nothing.
    expect(suite).toContain("create temp table team_editions");
    expect(suite).toMatch(/\(now\(\) - interval '4 days'\)::date/);
    expect(suite).not.toMatch(/is_edition_open\('20\d\d-/);
    expect(suite).not.toMatch(/team_effective_config_version\([^)]*'20\d\d-/);
  });

  it("covers every scenario Prompt 1 §20 asked for", () => {
    for (const [label, needle] of [
      ["RLS ownership", "B1 an outsider sees no team"],
      ["cross-team leakage", "B4 an outsider sees no team assignment"],
      ["private grades inaccessible", "B10 the answer key is unreadable"],
      ["attempt uniqueness", "B32 exactly one attempt exists"],
      ["server deadline", "B17 the deadline is 20 seconds"],
      ["skip", "B35 a skip is an explicit submit worth zero"],
      ["late answer", "C1 an answer after the server deadline scores zero"],
      ["multi-team fanout", "B27 it counted for both teams"],
      ["cross-language identity", "B39 there is one attempt, not one per language"],
      ["config effective next edition", "D4 the edition in flight keeps its original config"],
      ["mid-edition join", "B14 the late joiner is eligible for the next edition"],
      ["historical score survives leave", "D13 the leaver"],
      ["non-member cannot subscribe", "B7 an outsider cannot subscribe"]
    ] as const) {
      expect(suite, label).toContain(needle);
    }
  });
});

describe("realtime", () => {
  it("uses Broadcast on a private per-team channel and nothing else", () => {
    expect(allCode).toContain("realtime.send");
    expect(allCode).toContain("team_leaderboard_topic");
    // Postgres Changes and Presence are both budget sinks on the Free tier.
    expect(allCode).not.toMatch(/supabase_realtime/i);
    expect(allCode).not.toMatch(/ALTER PUBLICATION/i);
    expect(allCode).not.toMatch(/presence/i);
  });

  it("authorizes subscribers by membership, and lets none of them publish", () => {
    // Scoped to the policy body: an unanchored search would run past it and
    // match an INSERT policy on an unrelated table further down the file.
    const policy = /CREATE POLICY[^;]*?ON realtime\.messages([\s\S]*?)\$policy\$/i.exec(allCode);

    expect(policy, "no policy on realtime.messages").not.toBeNull();
    expect(policy?.[1]).toMatch(/FOR SELECT/i);
    expect(policy?.[1]).not.toMatch(/FOR (INSERT|UPDATE|DELETE|ALL)/i);
    expect(policy?.[1]).toContain("public.can_read_team_topic");
  });

  it("carries no score in the broadcast payload", () => {
    const broadcast = functions.find(
      (definition) => definition.name === "public.broadcast_team_leaderboard_change"
    );

    expect(broadcast).toBeDefined();
    expect(broadcast?.body).not.toMatch(/score/i);
  });
});
