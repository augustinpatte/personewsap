import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Personal interests and Team interests are two configurations.
 *
 * A reader's own topics decide their own edition; a Team's topics decide what
 * the Team plays. Nothing a Team does writes the reader's preferences, nothing
 * the reader does to their preferences writes a Team, and a Team member can
 * read and play what their Team was assigned whatever they follow personally.
 *
 * Checked three ways: by running the real client functions against a Supabase
 * double that records every table and RPC they touch; by reading the SQL that
 * decides access; and by the pure functions the screens use.
 */

vi.stubGlobal("__DEV__", false);

type Touch = { kind: "rpc" | "read" | "write"; name: string };
const touched: Touch[] = [];

const WRITE_METHODS = new Set(["insert", "upsert", "update", "delete"]);

/** A query builder that answers anything, records what it was asked, and resolves empty. */
function builder(table: string): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") {
          return (resolve: (value: unknown) => void) => resolve({ data: null, error: null, count: 0 });
        }

        return (..._args: unknown[]) => {
          if (WRITE_METHODS.has(prop)) {
            touched.push({ kind: "write", name: table });
          } else if (prop === "select") {
            touched.push({ kind: "read", name: table });
          }

          return proxy;
        };
      }
    }
  );

  return proxy;
}

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (name: string) => {
      touched.push({ kind: "rpc", name });
      return builder(`rpc:${name}`);
    },
    storage: { from: (bucket: string) => builder(`storage:${bucket}`) },
    auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) }
  },
  normalizeSupabaseError: (error: { code?: string; message?: string } | null) => ({
    code: error?.code ?? "unknown",
    message: error?.message ?? "unknown"
  })
}));

const { archiveTeam, createTeam, joinTeamWithCode, leaveTeam, removeTeamMember, saveTeamConfig, transferTeamOwnership } =
  await import("./teamsData");
const { loadEditablePreferences, saveEditablePreferences } = await import("../preferences/preferencesPersistence");
const { showModuleDisabledState } = await import("../modules/moduleAvailability");
const {
  DEFAULT_TEAM_INTENSITY,
  TEAM_PRESETS,
  canonicalTopicIdsFromPersonalSelection,
  recommendTeamPreset
} = await import("./teamPresets");
const { INITIAL_TEAM_SETUP, teamSetupReducer } = await import("./teamSetupFlow");
const { getTeamsCopy } = await import("./teamsCopy");

const PERSONAL_TABLES = ["user_topic_preferences", "user_mini_case_topic_preferences", "user_preferences"];
const isPersonal = (touch: Touch) => PERSONAL_TABLES.includes(touch.name);
const isTeam = (touch: Touch) => touch.name.startsWith("team") || /team/.test(touch.name);

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");
const migrationsDir = join(repoRoot, "supabase", "migrations");
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(migrationsDir, file), "utf8") }));
const teamsDir = __dirname;
const read = (...segments: string[]) => readFileSync(join(teamsDir, ...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

/** The body of a function as it stands now: its LAST CREATE OR REPLACE across the migrations. */
function currentFunction(name: string): { file: string; body: string } {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const defining = migrations.filter((migration) => migration.sql.includes(marker));
  const latest = defining[defining.length - 1];

  if (!latest) {
    throw new Error(`No definition of ${name}`);
  }

  const start = latest.sql.lastIndexOf(marker);
  const end = latest.sql.indexOf("$$;", latest.sql.indexOf("AS $$", start) + 5);

  return { file: latest.file, body: stripComments(latest.sql.slice(start, end)) };
}

beforeEach(() => {
  touched.length = 0;
});

describe("1. two configurations, stored apart", () => {
  it("keeps Team topics in the Team config tables and personal topics in the personal ones", () => {
    const foundation = migrations.find((migration) => migration.file.endsWith("_teams_foundation.sql"))!.sql;

    expect(foundation).toContain("CREATE TABLE IF NOT EXISTS public.team_config_newsletter_topics");
    expect(foundation).toContain("CREATE TABLE IF NOT EXISTS public.team_config_mini_case_topics");
    // Neither table references a reader's preferences; both hang off a Team version.
    expect(stripComments(foundation)).not.toMatch(/REFERENCES public\.user_\w*preferences/);
  });

  it("gives the Teams data layer no route to the personal tables", () => {
    expect(stripComments(read("teamsData.ts"))).not.toMatch(
      /user_topic_preferences|user_mini_case_topic_preferences|user_preferences/
    );
  });

  it("gives the personal preference writers no route to a Team", () => {
    for (const file of [
      join("..", "preferences", "preferencesPersistence.ts"),
      join("..", "onboarding", "persistence.ts"),
      join("..", "preferences", "PreferencesEditor.tsx")
    ]) {
      expect(stripComments(read(file)), file).not.toMatch(/team_config|update_team_config|teamsData|features\/teams|\.\.\/teams/);
    }
  });

  it("puts no trigger on either side that could copy one into the other", () => {
    for (const { file, sql } of migrations) {
      const triggers = stripComments(sql).match(/CREATE (?:OR REPLACE )?TRIGGER[\s\S]*?;/gi) ?? [];

      for (const trigger of triggers) {
        expect(trigger, file).not.toMatch(/ON public\.(user_\w*preferences|team_config_\w+)/);
      }
    }
  });
});

describe("2–5. Team actions never touch personal preferences", () => {
  it("creating a Team", async () => {
    await createTeam("Loyola Finance");
    await saveTeamConfig({
      teamId: "team-1",
      newsletterTopics: [{ topicId: "law", articlesCount: 1 }],
      miniCaseTopics: ["law_compliance"]
    });

    expect(touched.filter((touch) => touch.kind === "rpc").map((touch) => touch.name)).toEqual([
      "create_team",
      "update_team_config"
    ]);
    expect(touched.filter(isPersonal)).toEqual([]);
  });

  it("joining a Team", async () => {
    await joinTeamWithCode("ABCD2345");

    expect(touched.map((touch) => touch.name)).toEqual(["join_team_with_invite"]);
    expect(touched.filter(isPersonal)).toEqual([]);
  });

  it("changing a Team's configuration", async () => {
    await saveTeamConfig({
      teamId: "team-1",
      newsletterTopics: [
        { topicId: "tech_ai", articlesCount: 2 },
        { topicId: "law", articlesCount: 1 }
      ],
      miniCaseTopics: []
    });

    expect(touched.map((touch) => touch.name)).toEqual(["update_team_config"]);
    expect(touched.filter(isPersonal)).toEqual([]);
  });

  it("leaving, being removed from, archiving and handing over a Team", async () => {
    await leaveTeam("team-1");
    await removeTeamMember({ teamId: "team-1", userId: "user-2" });
    await archiveTeam("team-1");
    await transferTeamOwnership({ teamId: "team-1", newOwnerId: "user-2" });

    expect(touched.filter(isPersonal)).toEqual([]);
    expect(touched.every((touch) => touch.kind === "rpc")).toBe(true);
  });

  it("is also true of the server functions behind those actions", () => {
    for (const name of [
      "create_team",
      "join_team_with_invite",
      "leave_team",
      "update_team_config",
      "remove_team_member",
      "archive_team",
      "transfer_team_ownership"
    ]) {
      const { body } = currentFunction(name);

      // Guard against a vacuous pass: the extracted body is the real function.
      expect(body.length, name).toBeGreaterThan(200);
      expect(body, name).toMatch(/\b(BEGIN|SELECT)\b/);
      expect(body, name).not.toMatch(/user_\w*preferences/);
    }
  });

  it("asks someone joining for no topics at all", () => {
    expect(stripComments(read("JoinTeamScreen.tsx"))).not.toMatch(
      /TeamConfigFields|PresetGrid|IntensityOptions|topic|preference/i
    );
  });
});

describe("6. personal changes never touch a Team", () => {
  it("saving personal preferences writes only personal tables", async () => {
    await saveEditablePreferences("user-1", {
      language: "en",
      enabledModules: ["newsletter", "mini_case"],
      selectedTopics: ["finance_economy", "stock_market"],
      miniCaseTopics: ["finance_economy"],
      articlesPerTopic: { finance_economy: 2, stock_market: 1 }
    });

    expect(touched.filter((touch) => touch.kind === "write").length).toBeGreaterThan(0);
    expect(touched.filter(isTeam)).toEqual([]);
  });

  it("and no server function that writes a Team config lives outside the Teams migrations", () => {
    const writers = migrations
      .filter(({ sql }) => /(INSERT INTO|UPDATE|DELETE FROM)\s+public\.team_config_/i.test(stripComments(sql)))
      .map(({ file }) => file);

    expect(writers).toEqual(["20260906092000_teams_foundation.sql", "20260907140000_teams_security_hardening.sql"]);
  });
});

describe("7–8. a Team member reads Team content outside their own interests, and only that", () => {
  it("is entitled by the Team assignment, with no topic or preference in the rule", () => {
    const team = currentFunction("user_has_team_content_entitlement").body;

    expect(team).toContain("public.team_content_assignments");
    expect(team).not.toMatch(/preferences|topic_id|daily_drops/);
  });

  it("composes that entitlement into the one content read rule", () => {
    const entitlement = currentFunction("user_has_content_entitlement").body;

    expect(entitlement).toContain("public.user_has_assigned_content(target_content_item_id)");
    expect(entitlement).toContain("public.user_has_team_content_entitlement(target_content_item_id)");
    expect(entitlement).not.toMatch(/preferences/);
  });

  it("reaches the Team's questions the same way", () => {
    const questions = currentFunction("user_has_question_assignment").body;

    expect(questions).toContain("public.team_question_assignments");
    expect(questions).not.toMatch(/preferences/);
  });

  it("lists the Team's content by membership, not by the reader's topics", () => {
    const edition = currentFunction("get_my_team_edition_content").body;

    expect(edition).not.toMatch(/preferences/);
    expect(edition).toContain("m.left_at IS NULL");
  });

  it("still requires an open, eligible membership of an active Team, and published content", () => {
    const team = currentFunction("user_has_team_content_entitlement").body;

    expect(team).toContain("m.user_id = auth.uid()");
    expect(team).toContain("m.left_at IS NULL");
    expect(team).toContain("m.eligible_from_edition <= a.edition_date");
    expect(team).toContain("t.status = 'active'");
    expect(team).toContain("ci.status = 'published'");
  });

  it("keeps the content read policy to exactly those routes", () => {
    const policies = migrations
      .map(({ sql }) => stripComments(sql))
      .join("\n")
      .match(/CREATE POLICY "Users can read assigned published content"[\s\S]*?\);\s*$/gm);
    const current = policies?.[policies.length - 1] ?? "";

    expect(current).toContain("public.user_has_content_entitlement(id)");
    expect(current).toContain("status = 'published'");
    expect(current).not.toMatch(/preferences/);
  });

  it("merges Team items into the reader's edition without filtering them by the reader's topics", () => {
    const data = stripComments(read("..", "today", "dailyDropData.ts"));

    expect(data).toContain("teamOnlyAssignments");
    expect(data).toContain("buildTeamOnlyDropShell");
    expect(data).not.toMatch(/selectedTopics|topicPreferences|user_topic_preferences/);
  });
});

describe("the bug this closes: a module switched off personally no longer hides a Team's content", () => {
  const off = { status: "ready" as const, enabled: false };
  const on = { status: "ready" as const, enabled: true };
  const teamItem = { teams: [{ id: "team-1", name: "Loyola" }] };
  const personalItem = { teams: [] };

  it("shows a Team's mini cases to a member who turned mini cases off for themselves", () => {
    expect(showModuleDisabledState({ preference: off, dropStatus: "ready", items: [teamItem] })).toBe(false);
  });

  it("still honours the personal choice when no Team assigned anything", () => {
    expect(showModuleDisabledState({ preference: off, dropStatus: "ready", items: [] })).toBe(true);
    expect(showModuleDisabledState({ preference: off, dropStatus: "ready", items: [personalItem] })).toBe(true);
  });

  it("never shows the disabled state to a reader who has the module on", () => {
    expect(showModuleDisabledState({ preference: on, dropStatus: "ready", items: [] })).toBe(false);
  });

  it("does not flash it while the edition is still loading", () => {
    expect(showModuleDisabledState({ preference: off, dropStatus: "loading", items: [] })).toBe(false);
  });

  it("is what both Team-playable tabs use", () => {
    for (const screen of ["NewsletterModuleScreen.tsx", "MiniCasesModuleScreen.tsx"]) {
      const source = stripComments(read("..", "modules", screen));

      expect(source, screen).toContain("showModuleDisabledState({");
      expect(source, screen).not.toContain('modulePreference.status === "ready" && !modulePreference.enabled');
    }
  });
});

describe("9–13. the preset recommendation", () => {
  it("uses only the explicit topic ids it is given, and ignores anything else", () => {
    expect(recommendTeamPreset(["law", "not_a_topic", "age:21", ""])).toBe("law");
    expect(canonicalTopicIdsFromPersonalSelection(["stock_market", "international", "school", "stock_market"])).toEqual([
      "business",
      "law"
    ]);
    // It takes a list of ids and nothing else: no profile, no history.
    expect(recommendTeamPreset.length).toBe(1);
  });

  it("reads the reader's topics without writing them", async () => {
    await loadEditablePreferences("user-1", "en");

    expect(touched.filter((touch) => touch.kind === "write")).toEqual([]);
    expect(touched.filter(isTeam)).toEqual([]);
  });

  it("recommends the focused preset that matches strongly", () => {
    expect(recommendTeamPreset(["finance"])).toBe("finance");
    expect(recommendTeamPreset(["finance", "business", "tech_ai"])).toBe("finance");
    expect(recommendTeamPreset(["medicine", "tech_ai"])).toBe("medicine");
    expect(recommendTeamPreset(["tech_ai", "engineering"])).toBe("tech_ai");
    expect(recommendTeamPreset(["sport_business", "business"])).toBe("sport_business");
  });

  it("chooses by weighted overlap, then by catalogue order on a tie", () => {
    // Finance and Business both cover these three with the same weights (9):
    // the tie goes to Finance, listed first.
    expect(recommendTeamPreset(["business", "finance", "tech_ai"])).toBe("finance");
    // The reader's tick order never matters.
    expect(recommendTeamPreset(["tech_ai", "business", "finance"])).toBe("finance");
  });

  it("is deterministic", () => {
    for (const topics of [["law"], ["medicine", "law"], ["culture_media", "business", "tech_ai"], []]) {
      expect(recommendTeamPreset(topics)).toBe(recommendTeamPreset([...topics]));
    }
  });

  it("falls back to Balanced when there is no meaningful match", () => {
    expect(recommendTeamPreset([])).toBe("balanced");
    expect(recommendTeamPreset(["unknown"])).toBe("balanced");
    // Two unrelated subjects: neither preset covers more than half.
    expect(recommendTeamPreset(["medicine", "sport_business"])).toBe("balanced");
    // Interests spread across every domain.
    expect(recommendTeamPreset(["finance", "tech_ai", "law", "culture_media", "sport_business", "medicine"])).toBe(
      "balanced"
    );
  });

  it("leaves Regular as the default level", () => {
    expect(DEFAULT_TEAM_INTENSITY).toBe("regular");
    expect(INITIAL_TEAM_SETUP.intensityId).toBe("regular");
  });

  it("only labels a preset: nothing is preselected and all nine stay offered", () => {
    const create = stripComments(read("CreateTeamScreen.tsx"));
    const parts = stripComments(read("TeamSetupParts.tsx"));

    expect(create).toContain("recommendedId={recommendedPresetId}");
    expect(create).not.toMatch(/choosePreset[^\n]*recommendedPresetId|presetId: recommendedPresetId/);
    expect(INITIAL_TEAM_SETUP.presetId).toBeNull();
    // The grid iterates the whole catalogue, whatever is recommended.
    expect(parts).toContain('TEAM_PRESETS.filter((preset) => preset.id !== "balanced")');
    expect(parts).toContain('TEAM_PRESETS.find((preset) => preset.id === "balanced")');
    expect(parts).not.toMatch(/TEAM_PRESETS\.filter\([^)]*recommended/);
    expect(TEAM_PRESETS).toHaveLength(9);
  });

  it("is never saved with the Team or written back to the reader", () => {
    const create = stripComments(read("CreateTeamScreen.tsx"));

    expect(create).not.toMatch(/saveEditablePreferences|saveOnboarding|upsert/);
    expect(create.match(/await saveTeamConfig\(\{[\s\S]*?\}\);/)?.[0]).not.toMatch(/recommend/);
  });
});

describe("14. Build from scratch", () => {
  it("is still offered, and still skips the intensity step", () => {
    expect(stripComments(read("CreateTeamScreen.tsx"))).toContain("onBuildFromScratch");
    expect(teamSetupReducer(INITIAL_TEAM_SETUP, { type: "buildFromScratch" }).step).toBe("manual");
  });
});

describe("15–16. saying so, once per path", () => {
  it("in English", () => {
    expect(getTeamsCopy("en").setupSeparateFromPersonal).toBe(
      "Team topics are separate from your personal interests."
    );
    expect(getTeamsCopy("en").setupRecommendedForYou).toBe("Recommended for you");
  });

  it("in French", () => {
    expect(getTeamsCopy("fr").setupSeparateFromPersonal).toBe(
      "Les sujets de votre Team n'affectent pas vos préférences personnelles."
    );
    expect(getTeamsCopy("fr").setupRecommendedForYou).toBe("Recommandé pour vous");
  });

  it("on the preset review and in the editor's review, and nowhere else", () => {
    const create = stripComments(read("CreateTeamScreen.tsx"));
    const preview = create.slice(create.indexOf('setup.step === "preview"'), create.indexOf('setup.step === "manual"'));
    const manual = create.slice(create.indexOf('setup.step === "manual"'));

    expect(preview.match(/copy\.setupSeparateFromPersonal/g)).toHaveLength(1);
    expect(manual.match(/copy\.setupSeparateFromPersonal/g)).toHaveLength(1);
    expect(create.match(/copy\.setupSeparateFromPersonal/g)).toHaveLength(2);

    for (const other of ["TeamManageScreen.tsx", "JoinTeamScreen.tsx", "TeamsLandingScreen.tsx", "TeamDetailScreen.tsx"]) {
      expect(read(other), other).not.toContain("setupSeparateFromPersonal");
    }
  });
});

describe("17–18. existing Teams and the next-edition rule", () => {
  it("still versions every configuration change from the next edition", () => {
    const update = currentFunction("update_team_config");

    expect(update.file).toBe("20260906092000_teams_foundation.sql");
    expect(update.body).toContain("v_effective := public.next_scoring_edition_date();");
  });

  it("leaves existing Teams exactly as configured: no migration, nothing re-applied", () => {
    // This work adds no migration, and Manage opens on the Team's real pending
    // configuration with no preset or recommendation applied to it.
    const manage = stripComments(read("TeamManageScreen.tsx"));

    expect(manage).toContain('fetchTeamConfig({ teamId, scope: "pending" })');
    expect(manage).not.toMatch(/recommendTeamPreset|loadEditablePreferences/);
    expect(migrations.map(({ file }) => file).filter((file) => /preset|recommend|personal_interest/i.test(file))).toEqual(
      []
    );
  });
});
