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
  "20260906095000_realtime_and_moderation.sql",
  "20260906103000_team_content_assignments.sql",
  "20260906104000_edition_assignment_engine.sql",
  "20260906106000_team_read_surface_and_invite.sql",
  "20260907120000_team_archive_content.sql"
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
      "public.team_content_assignments",
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
      "public.team_content_assignments",
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
      "public.team_content_assignments",
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
      "public.generate_team_invite_code",
      "public.materialize_solo_question_assignments",
      "public.materialize_team_content_assignments",
      "public.materialize_team_question_assignments",
      "public.initialize_team_edition_roster",
      "public.materialize_team_edition_assignments",
      "public.materialize_edition_assignments"
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
        // never variable-substituted: an INSERT column list and the left-hand
        // side of a SET. Everything else must be written as alias.column.
        //
        // AN `ON CONFLICT (...)` TARGET IS NOT ONE OF THEM, and an earlier
        // version of this check wrongly assumed it was. Index inference accepts
        // arbitrary expressions, because a unique index may be partial or on an
        // expression, so it IS an expression context and IS substituted. That
        // exemption is what let 20260906080000's bug reach production and stay
        // there: `claim_push_notification_deliveries` failed 42702 on every call
        // it ever received, and no edition notification was ever delivered.
        //
        // `ON CONFLICT ON CONSTRAINT <name>` is genuinely safe — a constraint
        // name is not an expression — and is the form to prefer.
        const body = definition.body
          .replace(/INSERT INTO[\s\S]*?\)\s*(?=VALUES|SELECT|ON CONFLICT)/gi, " ")
          .replace(/ON CONFLICT\s+ON CONSTRAINT\s+\w+/gi, " ")
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

describe("team content entitlement", () => {
  const entitlement = stripNoise(sources.get("20260906103000_team_content_assignments.sql")!);

  it("anchors a team assignment on the logical content, never on one language's row", () => {
    // A Team assignment naming a content_items id would hand the French member
    // the English article or nothing at all. The column is the logical key, and
    // the entitlement predicate joins on it.
    expect(entitlement).toMatch(/content_logical_key TEXT NOT NULL/);
    expect(entitlement).not.toMatch(/content_item_id UUID NOT NULL REFERENCES public\.content_items/);
    expect(entitlement).toMatch(
      /a\.content_logical_key = public\.content_logical_key\(ci\.metadata\)/
    );
  });

  it("keeps Business Stories and the Learning Path out of Team content", () => {
    expect(entitlement).toContain("team_content_assignments_type_check");
    expect(entitlement).toMatch(
      /team_content_assignments_type_check\s*\n?\s*CHECK \(content_type IN \(\s*''\s*,\s*''\s*\)\)/
    );
  });

  it("makes a team entitlement exactly as strict as a personal one", () => {
    // Every one of these terms is load-bearing: drop any and a Team assignment
    // starts granting more than the reader is entitled to.
    for (const term of [
      "t.status = ''",
      "m.left_at IS NULL",
      "m.eligible_from_edition <= a.edition_date",
      "ci.status = ''"
    ]) {
      expect(entitlement, term).toContain(term);
    }
  });

  it("never widens assigned content into all published content", () => {
    // The failure mode this whole file has to avoid: a policy that stops asking
    // who the item was assigned to. Every SELECT policy it rewrites must still
    // carry at least one entitlement predicate.
    const policies = [
      ...entitlement.matchAll(/CREATE POLICY[\s\S]*?USING \(([\s\S]*?)\n\);/g)
    ].map((match) => match[1]);

    expect(policies.length).toBeGreaterThan(4);

    for (const policy of policies) {
      expect(
        /user_has_assigned_content|user_has_assigned_source|user_has_team_content|user_has_content_entitlement|is_active_team_member|user_id = auth\.uid\(\)/.test(
          policy
        ),
        policy.slice(0, 160)
      ).toBe(true);
    }
  });

  it("does not redefine the historic personal predicates", () => {
    // user_has_assigned_content answers a narrower question that the archive
    // view, the write paths and other policies all depend on. It is composed,
    // never rewritten.
    expect(entitlement).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.user_has_assigned_content\s*\(/i
    );
    expect(entitlement).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.user_has_assigned_source\s*\(/i
    );
    expect(entitlement).not.toMatch(
      /CREATE OR REPLACE FUNCTION public\.user_has_assigned_content_translation\s*\(/i
    );
  });

  it("keeps interactions anchored to the caller", () => {
    for (const match of entitlement.matchAll(
      /CREATE POLICY[^;]*?ON public\.(content_interactions|mini_case_responses)[\s\S]*?;/g
    )) {
      expect(match[0], match[0].slice(0, 120)).toContain("user_id = auth.uid()");
    }
  });

  it("returns no private field from the team content RPC", () => {
    const rpc = functions.find(
      (definition) => definition.name === "public.get_my_team_edition_content"
    );

    expect(rpc).toBeDefined();

    for (const forbidden of ["invite_code", "score_milli", "grade_band", "logical_question_grades"]) {
      expect(rpc?.body, forbidden).not.toContain(forbidden);
    }

    // The language is the profile's, or one of the two the product has.
    expect(rpc?.body).toContain("FROM public.profiles p");
    expect(rpc?.body).toMatch(/WHEN p_language = ''\s*THEN ''/);
  });
});

describe("the assignment engine", () => {
  const engine = stripNoise(sources.get("20260906104000_edition_assignment_engine.sql")!);

  it("selects deterministically", () => {
    // Not random, not a clock, not an insertion order. The publisher's ordinal,
    // with the logical key as the only tie-break.
    expect(engine).not.toMatch(/\brandom\s*\(/i);
    expect(engine).not.toMatch(/ORDER BY[^;]*\bnow\s*\(/i);
    expect(engine).not.toMatch(/ORDER BY[^;]*\bcreated_at\b[^;]*LIMIT/i);
    expect(engine).toContain("public.content_edition_ordinal");
    expect(engine).toMatch(/ORDER BY c\.ordinal, c\.logical_key/);
  });

  it("caps a team newsletter topic at two articles", () => {
    expect(engine).toMatch(/LIMIT least\(2, greatest\(1, v_topic\.articles_count\)\)/);
  });

  it("writes nothing twice", () => {
    // Every INSERT in the engine has to be a no-op on a second run, or
    // re-materializing an edition doubles a question set somebody is mid-way
    // through answering.
    const inserts = [...engine.matchAll(/INSERT INTO public\.\w+[\s\S]*?;/g)];

    expect(inserts.length).toBeGreaterThan(2);

    for (const insert of inserts) {
      expect(insert[0], insert[0].slice(0, 90)).toMatch(
        /ON CONFLICT ON CONSTRAINT \w+ DO NOTHING/
      );
    }
  });

  it("snapshots the config version onto every row it writes", () => {
    expect(engine).toMatch(/config_version_id[\s\S]{0,400}v_config/);
    expect(engine).toContain("public.team_effective_config_version");
  });

  it("derives personal assignments from the reader's own edition", () => {
    const solo = functions.find(
      (definition) => definition.name === "public.materialize_solo_question_assignments"
    );

    expect(solo?.body).toContain("public.daily_drops");
    expect(solo?.body).toContain("public.daily_drop_items");
    // The logical key, so a language switch does not produce a second assignment.
    expect(solo?.body).toContain("public.content_logical_key(ci.metadata)");
  });

  it("pre-populates the roster from the ledger instead of resetting it", () => {
    const roster = functions.find(
      (definition) => definition.name === "public.initialize_team_edition_roster"
    );

    expect(roster?.body).toContain("public.refresh_team_member_edition_score");
    // A direct write would overwrite a score somebody already earned.
    expect(roster?.body).not.toMatch(/INSERT INTO public\.team_member_edition_scores/i);
    expect(roster?.body).toContain("m.eligible_from_edition <= p_edition_date");
  });
});

const ownershipRaw = readFileSync(
  join(migrationsDir, "20260906102000_team_ownership_and_deletion.sql"),
  "utf8"
);
const scoringRaw = readFileSync(
  join(migrationsDir, "20260906094000_question_attempts_and_scoring.sql"),
  "utf8"
);
const surfaceRaw = readFileSync(
  join(migrationsDir, "20260906106000_team_read_surface_and_invite.sql"),
  "utf8"
);

describe("historical standings are immutable records", () => {
  it("never deletes a team", () => {
    // Every scoring table cascades from `teams`, so a DELETE takes the history
    // of everybody who left earlier with it. The first version of the
    // account-deletion trigger did exactly that.
    expect(allCode).not.toMatch(/DELETE FROM public\.teams/i);
    expect(allCode).not.toMatch(/DELETE FROM\s+public\.team_member_edition_scores/i);
    expect(allCode).not.toMatch(/DELETE FROM\s+public\.team_question_scores/i);
  });

  it("archives and un-owns instead, when nobody is left", () => {
    const ownership = stripNoise(
      readFileSync(join(migrationsDir, "20260906102000_team_ownership_and_deletion.sql"), "utf8")
    );

    expect(ownership).toMatch(/UPDATE public\.teams[\s\S]{0,200}status = ''[\s\S]{0,200}owner_id = NULL/i);
  });

  it("closes a membership stint rather than removing it", () => {
    // Leaving and being removed are the same write: left_at. A DELETE would
    // take the answer to "was this person in the team when that edition was
    // scored" with it.
    expect(allCode).not.toMatch(/DELETE FROM public\.team_members/i);
    expect(allCode).toMatch(/SET left_at = /);
  });

  it("hands a team on by a deterministic rule", () => {
    // Two readers deleting their accounts in a different order must not produce
    // two different teams.
    expect(allCode).toContain("ORDER BY m.joined_at, m.user_id");
  });

  it("lets an owner be NULL only on an archived team", () => {
    expect(allCode).toContain("teams_active_needs_owner_check");
    expect(allCode).toMatch(
      /CHECK \(\s*status = ''\s*OR owner_id IS NOT NULL\s*\)/i
    );
    expect(allCode).toContain("owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL");
  });

  it("refuses to let an owner walk out on a team that is still played", () => {
    // Read raw: the message is a SQL string literal, which stripNoise blanks.
    expect(ownershipRaw + scoringRaw + sources.get("20260906092000_teams_foundation.sql")!).toContain(
      "Transfer ownership before leaving a team that still has members"
    );
  });
});

describe("the leaderboard shows everyone", () => {
  const scoring = stripNoise(
    readFileSync(
      join(migrationsDir, "20260906094000_question_attempts_and_scoring.sql"),
      "utf8"
    )
  );

  it("starts from the roster, not from the score table", () => {
    // Reading from team_member_edition_scores alone makes a member with no row
    // invisible — and that is exactly the person the screen most needs to show.
    expect(scoring).toMatch(
      /WITH roster AS \([\s\S]{0,400}FROM public\.team_members m[\s\S]{0,900}LEFT JOIN public\.team_member_edition_scores/
    );
  });

  it("never calls an unassigned member completed", () => {
    // Answering none of nothing is not finishing.
    expect(scoring).toMatch(/WHEN sc\.total_assigned = 0 THEN ''/);
  });

  it("says 'starts next edition' instead of a false zero", () => {
    expect(scoring).toMatch(/sc\.eligible_from > v_edition THEN ''/);
  });

  it("keeps the ranking convention the client already implements", () => {
    // apps/mobile/.../leaderboard.ts ranks 1, 2, 2, 4 and its tests assert it.
    // The two have to agree on one number.
    expect(scoring).toContain("pg_catalog.rank() OVER (ORDER BY sc.total_score DESC)");
    expect(scoring).not.toContain("dense_rank()");
  });

  it("derives the week from edition dates, never from a clock", () => {
    expect(scoringRaw).toContain("date_trunc('week', s.edition_date::TIMESTAMP)");
    // A cast to timestamp WITHOUT a zone, so there is no offset to disagree
    // about between two readers' devices.
    expect(scoringRaw).not.toMatch(/date_trunc\([^)]*AT TIME ZONE/i);
  });

  it("shows the current roster and rewrites nobody's history", () => {
    expect(scoring).toMatch(/FROM public\.team_members m\s*\n\s*WHERE m\.team_id = p_team_id\s*\n\s*AND m\.left_at IS NULL/);
    expect(scoring).not.toMatch(/UPDATE public\.team_member_edition_scores[\s\S]{0,200}left_at/i);
  });
});

describe("the streak counts editions", () => {
  const scoring = stripNoise(
    readFileSync(
      join(migrationsDir, "20260906094000_question_attempts_and_scoring.sql"),
      "utf8"
    )
  );

  it("walks public.editions rather than a calendar", () => {
    // The cadence is Mon/Wed/Fri/Sun, so a Tuesday is not a missed edition.
    expect(scoring).toContain("FROM public.editions e");
    expect(scoring).not.toMatch(/interval ''1 day''/i);
  });

  it("treats an edition the team did not play as neutral", () => {
    expect(scoring).toContain("team_was_playing");
    expect(scoring).toMatch(/IF NOT v_row\.team_was_playing THEN\s*\n\s*CONTINUE;/);
  });

  it("starts at the current stint, so a rejoin restarts it", () => {
    expect(scoring).toContain("AND m.left_at IS NULL");
    expect(scoring).toContain("WHERE e.edition_date >= v_eligible");
  });
});

describe("what a member may read about their team", () => {
  const surface = stripNoise(
    readFileSync(
      join(migrationsDir, "20260906106000_team_read_surface_and_invite.sql"),
      "utf8"
    )
  );
  const foundation = stripNoise(
    readFileSync(join(migrationsDir, "20260906092000_teams_foundation.sql"), "utf8")
  );

  it("gives authenticated no SELECT on public.teams", () => {
    // Row-level security decides WHICH ROWS, never which columns. A policy that
    // lets a member read their team lets them read the invite code in it.
    expect(foundation).not.toMatch(/GRANT SELECT ON TABLE public\.teams TO authenticated/i);
  });

  it("serves a sanitised projection instead", () => {
    expect(surface).toContain("CREATE OR REPLACE VIEW public.team_directory");
    expect(surface).toContain("GRANT SELECT ON public.team_directory TO authenticated");
  });

  it("carries its own access rule, because owner rights skip the policy", () => {
    // The view runs with owner rights — it has to, since `authenticated` holds
    // nothing on `public.teams` and an invoker-rights view would be denied for
    // every caller. That means the teams RLS policy is NOT consulted, so the
    // predicate in the view IS the access rule.
    expect(surfaceRaw).not.toContain("security_invoker = true");
    expect(surface).toMatch(
      /CREATE OR REPLACE VIEW public\.team_directory AS[\s\S]*?WHERE public\.is_active_team_member\(t\.id\);/
    );
  });

  it("keeps the invite code out of the projection", () => {
    const view = /CREATE OR REPLACE VIEW public\.team_directory AS([\s\S]*?);/.exec(surface);

    expect(view).not.toBeNull();
    expect(view?.[1]).not.toMatch(/invite_code/);
    expect(view?.[1]).not.toMatch(/owner_id\s*,/);
  });

  it("resolves moderation in the database, not in each client", () => {
    for (const fragment of [
      "CASE WHEN t.name_status = 'hidden' THEN NULL ELSE t.name END"
    ]) {
      // Once in the view, once in the detail RPC, once in the badge RPC.
      expect(
        surface.split("CASE WHEN t.name_status = '' THEN NULL ELSE t.name END").length - 1,
        fragment
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("makes the invite code owner-only", () => {
    expect(surface).toContain("CREATE OR REPLACE FUNCTION public.get_team_invite_code");
    expect(surface).toMatch(
      /get_team_invite_code[\s\S]{0,600}IF NOT public\.is_team_owner\(p_team_id\) THEN/
    );
    expect(surface).toMatch(
      /set_team_invite_open[\s\S]{0,600}IF NOT public\.is_team_owner\(p_team_id\) THEN/
    );
  });

  it("lets an archived team close its door but never reopen it", () => {
    // is_team_owner requires status = 'active', so every owner action is
    // already unreachable on an archived team.
    expect(allCode).toContain("AND t.status = ''");
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

  it("puts the assignment fixture on a quiet day so real content cannot compete", () => {
    // The engine selects an edition's content by publication_date. A fixture
    // sharing that date with a real edition would let real articles win the
    // topic selection and the assertions would be about production data.
    expect(suite).toContain("public.resolve_edition_kind(d::date) is null");
    expect(suite).toMatch(/insert into team_editions \(label, edition_date\)\s*\n\s*select 'e3'/);
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

  it("covers every Team content and assignment scenario §19 asked for", () => {
    for (const [label, needle] of [
      ["team-only content entitlement", "E1 a team member can read team-only content"],
      ["non-member denied", "E2 a non-member cannot read team-only content"],
      ["mid-edition join denied", "E3 a mid-edition joiner is absent"],
      ["creator starts next edition", "E4 the founder is not score-eligible in the open edition"],
      ["config effective next edition", "E5 the first configuration takes effect next edition"],
      ["newsletter count 2", "E6 a topic configured for two articles gets two"],
      ["newsletter count 1", "E7 a topic configured for one article gets the first ordinal"],
      ["newsletter count 3 rejected", "E8 a newsletter depth of three is refused"],
      ["multi-team content dedupe", "E9 content assigned by two teams comes back once"],
      ["FR/EN logical entitlement", "E10 one logical assignment entitles both renderings"],
      ["team-only interaction allowed", "E11 a team-only article can be marked complete"],
      ["unassigned content denied", "E12 content nobody assigned stays unreadable"],
      ["team source readable", "E13 the sources of team-only content are readable"],
      ["unrelated source denied", "E14 a source cited only by unassigned content is not"],
      ["solo assignments materialized", "E15 the reader''s own content produced solo assignments"],
      ["team assignments materialized", "E16 team assignments were materialized"],
      ["mini case produces three", "E17 a team mini case produces exactly three questions"],
      ["business story never team", "E18 a business story cannot be assigned to a team"],
      ["rerun idempotent", "E19 rerunning the engine changes nothing"],
      ["zero-score roster", "E20 an eligible member has a zero-score row before playing"],
      ["config snapshot", "E21 every team assignment records its config version"],
      ["unassigned interaction denied", "E22 an unassigned article cannot be marked complete"],
      ["no team leak into personal", "E30 team content did not leak into personal assignments"],
      ["team feed is team only", "E31 the team feed carries only team content"],
      ["language switch is not a new assignment", "E32 both languages resolve to the same logical content"],
      ["removal preserves history", "G2 removal keeps every point already earned"],
      ["owner must transfer before leaving", "G4 an owner with members must transfer first"],
      ["owner alone archives", "G5 an owner alone archives rather than deletes"],
      ["transfer owner", "G6 ownership moves to the named member"],
      ["delete owner with successor", "G8 deleting the owner hands the team"],
      ["delete owner without successor archives", "G10 a team nobody is left in is archived"],
      ["history survives every deletion", "G11 the earlier leaver"],
      ["not started visible", "H2 a member who has not answered reads as not started"],
      ["next-edition member status", "H3 a joiner who cannot score yet says so"],
      ["zero point user still visible", "H4 a zero-point member is still on the board"],
      ["tie ranking", "H5 a shared score is a shared rank"],
      ["in progress", "H6 some but not all reads as in progress"],
      ["completed", "H7 all of them reads as completed"],
      ["week across timezone", "H9 This Week is the same on both sides of the date line"],
      ["edition streak", "H10 a completed edition counts toward the streak"],
      ["quiet days do not break streak", "H11 an edition the team did not play is neutral"],
      ["non-owner cannot read invite code", "H12 a member cannot read the invite code"],
      ["members hold no select on teams", "H14 members hold no SELECT on public.teams"],
      ["owner can manage invite", "H15 the owner can read it"],
      ["hidden name never leaked", "H18 a hidden name is never returned by the directory"],
      ["archived team cannot join", "H20 an archived team cannot be joined"]
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

describe("the Team archive surface", () => {
  const archive = sources.get("20260907120000_team_archive_content.sql") ?? "";

  it("applies the same eligibility rule as every other Team surface", () => {
    // A member who joined during edition E1 never sees E1's Team content — in
    // the archive or anywhere. Comparing against TODAY instead of against the
    // assignment's edition is the way this goes wrong, and it goes wrong
    // silently: it only shows up as a reader seeing content from before they
    // joined.
    expect(archive).toContain("m.left_at IS NULL");
    expect(archive).toContain("m.eligible_from_edition <= a.edition_date");
    expect(archive).toContain("t.status = 'active'");
  });

  it("grants nothing durable: it lists, and RLS still authorises", () => {
    // No table, no entitlement row, no INSERT. A reader who leaves a team stops
    // seeing its content because the membership predicate stops matching, not
    // because something has to be cleaned up.
    expect(archive).not.toMatch(/CREATE TABLE/i);
    expect(archive).not.toMatch(/\bINSERT INTO\b/i);
    expect(archive).not.toMatch(/\bGRANT (INSERT|UPDATE|DELETE)\b/i);
  });

  it("bounds the range server-side, so a client cannot ask for everything", () => {
    expect(archive).toMatch(/least\(greatest\(COALESCE\(p_limit, 200\), 1\), 500\)/);
    expect(archive).toContain("LIMIT (SELECT b.row_limit FROM bounds b)");
  });

  it("returns one row per edition and logical content, not one per team", () => {
    // Two teams assigning one article is the normal case; returning it twice
    // would push deduplication into every screen that reads it.
    expect(archive).toContain("GROUP BY a.edition_date, a.content_logical_key, a.content_type");
    expect(archive).toMatch(
      /DISTINCT ON \(mine\.assigned_edition, mine\.logical_key, mine\.logical_type\)/
    );
  });

  it("applies name moderation at read time, like every other team read", () => {
    expect(archive).toContain("CASE WHEN t.name_status = 'hidden' THEN NULL ELSE t.name END");
  });

  it("never selects anything from the private grading schema", () => {
    expect(archive).not.toMatch(/private\./);
    expect(archive).not.toMatch(/invite_code/);
    expect(archive).not.toMatch(/score_milli/);
  });
});
