import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getHelpCopy } from "./helpCopy";
import { getTeamsCopy, rangeLabel, statusLabel } from "./teamsCopy";

/**
 * The screen-level rules for Teams.
 *
 * Source assertions, in the idiom this repository already uses for React Native
 * components: the mobile tree cannot be rendered under jsdom, so the wiring is
 * pinned by reading it. What is checked here is the set of decisions that are
 * invisible in a screenshot and expensive to get wrong —
 *
 *   the profile gate exists on Teams and nowhere else;
 *   the landing screen opens no Realtime channel;
 *   the detail screen opens exactly one and closes it;
 *   no Presence anywhere;
 *   blocking hides a name and never a score.
 */

const teamsDir = __dirname;
const read = (...segments: string[]) => readFileSync(join(teamsDir, ...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const landing = stripComments(read("TeamsLandingScreen.tsx"));
const detail = stripComments(read("TeamDetailScreen.tsx"));
const gate = stripComments(read("TeamProfileGate.tsx"));
const channel = stripComments(read("useTeamLeaderboardChannel.ts"));
const data = stripComments(read("teamsData.ts"));
const countries = stripComments(read("countries.ts"));
const help = stripComments(read("HelpScreen.tsx"));

const appDir = join(teamsDir, "..", "..", "..", "app");
const settings = readFileSync(
  join(teamsDir, "..", "settings", "SettingsScreen.tsx"),
  "utf8"
);

describe("the profile gate is only on Teams", () => {
  it("is rendered by the Teams landing screen", () => {
    expect(landing).toContain("isProfileCompleteForTeams");
    expect(landing).toContain("<TeamProfileGate");
  });

  it("appears nowhere else in the app", () => {
    // A reader who never opens Teams never picks a username, and every other
    // screen has to keep working with profiles.username = NULL.
    const featuresDir = join(teamsDir, "..");

    for (const file of [
      join(featuresDir, "modules", "NewsletterModuleScreen.tsx"),
      join(featuresDir, "modules", "MiniCasesModuleScreen.tsx"),
      join(featuresDir, "modules", "StoriesModuleScreen.tsx"),
      join(featuresDir, "modules", "PathModuleScreen.tsx"),
      join(featuresDir, "settings", "SettingsScreen.tsx"),
      join(featuresDir, "auth", "AuthProvider.tsx")
    ]) {
      const source = readFileSync(file, "utf8");

      expect(source, file).not.toContain("TeamProfileGate");
      expect(source, file).not.toContain("isProfileCompleteForTeams");
    }
  });

  it("does not require an avatar to pass", () => {
    // A photo-library permission prompt in front of somebody joining their
    // friends' league is a wall, not an onboarding step.
    expect(gate).not.toMatch(/ImagePicker|requestMediaLibraryPermissions/);
    expect(gate).toContain("copy.avatarOptional");
  });

  it("treats the server as the authority on uniqueness", () => {
    // The local check is a courtesy; the write is the guard, and 23505 is the
    // race being reported rather than swallowed.
    expect(gate).toContain("isUsernameAvailable");
    expect(gate).toContain("savePlayerIdentity");
    expect(gate).toContain('result.error.code === "23505"');
    expect(gate).toContain("copy.usernameTaken");
  });

  it("asks for a country from a list and never from a sensor", () => {
    for (const forbidden of ["Location", "geolocation", "getCurrentPosition", "expo-location"]) {
      expect(gate, forbidden).not.toContain(forbidden);
      expect(countries, forbidden).not.toContain(forbidden);
    }

    expect(gate).toContain("searchCountries");
  });
});

describe("the Teams landing", () => {
  it("shows Join before Create", () => {
    // The overwhelmingly common first action is a code from a friend.
    expect(landing.indexOf("copy.join")).toBeLessThan(landing.indexOf("copy.create"));
  });

  it("opens no Realtime channel", () => {
    // A channel per Team here would spend a 200-connection budget on a list
    // nobody is watching change.
    expect(landing).not.toContain("useTeamLeaderboardChannel");
    expect(landing).not.toMatch(/\.channel\(|subscribe\(/);
  });

  it("has no feed, discovery or suggestions", () => {
    for (const forbidden of ["discover", "suggested", "explore", "public_teams", "feed"]) {
      expect(landing.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("pages its query rather than fetching everything", () => {
    expect(data).toContain(".range(offset, offset + limit - 1)");
  });

  it("fetches the whole list without a per-team round trip", () => {
    // Two extra queries for the list, not two per team — the N+1 a reader in
    // eight Teams would otherwise pay to draw one screen.
    expect(data).toContain("Promise.all");
    expect(data).toContain('.in("team_id", teamIds)');
  });
});

describe("the Team detail", () => {
  it("opens exactly one channel and closes it", () => {
    expect(detail).toContain("useTeamLeaderboardChannel");
    expect(channel).toContain("removeChannel");
    expect(channel).toMatch(/return \(\) => \{[\s\S]*?removeChannel/);
  });

  it("closes the channel when the app is backgrounded", () => {
    expect(channel).toContain("AppState.addEventListener");
    expect(channel).toContain("isActive = next ===");
  });

  it("refuses a broadcast that carries a score or an answer", () => {
    expect(channel).toContain("readLeaderboardChange");
  });

  it("uses no Presence and no Postgres Changes", () => {
    for (const source of [channel, detail, landing]) {
      expect(source).not.toMatch(/presence/i);
      expect(source).not.toMatch(/postgres_changes/i);
    }
  });

  it("runs no polling timer", () => {
    // The only setTimeout is the broadcast debounce; there is no interval
    // refetching the leaderboard on a schedule.
    expect(detail).not.toMatch(/setInterval/);
    expect(channel).not.toMatch(/setInterval/);
  });

  it("shows the three ranges and no divisions", () => {
    expect(detail).toContain("LEADERBOARD_RANGES");

    for (const forbidden of ["bronze", "silver", "gold", "division", "league tier"]) {
      expect(detail.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("keeps a blocked member's score while masking their identity", () => {
    expect(detail).toContain("displayIdentity");
    expect(detail).toContain("blockedUserIds");
    // The score cell reads the raw row, never the masked identity.
    expect(detail).toContain("formatTeamPoints(row.scoreMilli)");
  });
});

describe("copy", () => {
  it("localizes the three ranges and the three statuses in both languages", () => {
    for (const language of ["en", "fr"] as const) {
      const copy = getTeamsCopy(language);

      for (const range of ["edition", "week", "all_time"] as const) {
        expect(rangeLabel(range, copy).length, `${language}/${range}`).toBeGreaterThan(0);
      }

      for (const status of ["not_started", "in_progress", "completed"] as const) {
        expect(statusLabel(status, copy).length, `${language}/${status}`).toBeGreaterThan(0);
      }
    }

    // French that reads as French, not as a translated string.
    const fr = getTeamsCopy("fr");
    expect(fr.statusNotStarted).toBe("Pas commencé");
    expect(fr.statusInProgress).toBe("En cours");
    expect(fr.statusCompleted).toBe("Terminé");
  });

  it("says plainly that a mid-edition join starts next edition", () => {
    expect(getTeamsCopy("en").startsNextEdition).toContain("next edition");
    expect(getTeamsCopy("fr").startsNextEdition).toContain("prochaine édition");
  });

  it("says that a config change applies from the next edition", () => {
    expect(getTeamsCopy("en").configTakesEffect).toContain("next edition");
    expect(getTeamsCopy("fr").configTakesEffect).toContain("prochaine édition");
  });

  it("explains that a block does not change a score", () => {
    expect(getTeamsCopy("en").blockExplains).toContain("score is unchanged");
    expect(getTeamsCopy("fr").blockExplains).toContain("score est inchangé");
  });

  it("uses no emoji anywhere", () => {
    for (const language of ["en", "fr"] as const) {
      expect(JSON.stringify(getTeamsCopy(language))).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });
});

describe("the help pages", () => {
  it("are reachable from Account and not duplicated in Teams", () => {
    expect(settings).toContain("/help-scoring");
    expect(settings).toContain("/help-teams");
    expect(landing).not.toContain("help-scoring");
  });

  it("exist as routes", () => {
    for (const route of ["help-scoring.tsx", "help-teams.tsx"]) {
      expect(() => readFileSync(join(appDir, route), "utf8"), route).not.toThrow();
    }
  });

  it("explain the scoring rules a competitive product owes its readers", () => {
    for (const language of ["en", "fr"] as const) {
      const body = JSON.stringify(getHelpCopy(language).scoringPoints);

      expect(body, language).toMatch(language === "fr" ? /Vingt secondes/ : /Twenty seconds/);
      expect(body, language).toMatch(/0[.,]3/);
      expect(body, language).toMatch(/0[.,]6/);
      expect(body, language).toMatch(language === "fr" ? /bonus de vitesse/ : /No speed bonus/i);
      expect(body, language).toMatch(language === "fr" ? /une fois/ : /answered once/);
    }
  });

  it("explain how Teams work", () => {
    for (const language of ["en", "fr"] as const) {
      const body = JSON.stringify(getHelpCopy(language).teamsPoints);

      expect(body, language).toMatch(language === "fr" ? /code/ : /code/);
      expect(body, language).toMatch(language === "fr" ? /au-dessus du vôtre/ : /above your own/);
      expect(body, language).toMatch(language === "fr" ? /compte pour les deux/ : /counts for both/);
      expect(body, language).toMatch(language === "fr" ? /série/ : /streak/);
      expect(body, language).toMatch(
        language === "fr" ? /prochaine édition/ : /with the next edition/
      );
    }
  });

  it("reuses the reader chrome rather than a second design system", () => {
    expect(help).toContain("ReaderScaffold");
    expect(help).toMatch(/useThemedStyles/);
    expect(help).not.toMatch(/#[0-9a-f]{6}/i);
  });
});

describe("the design system is not duplicated", () => {
  it("builds every Teams surface from the existing components and tokens", () => {
    for (const [name, source] of [
      ["landing", landing],
      ["detail", detail],
      ["gate", gate]
    ] as const) {
      expect(source, name).toContain("tokens.space");
      expect(source, name).toMatch(/useThemedStyles|useThemeColors/);
      expect(source, name).not.toMatch(/#[0-9a-f]{6}/i);
      expect(source, name).not.toMatch(/gradient|confetti|trophy|badge-gold/i);
    }
  });

  it("keeps touch targets at 44pt or more", () => {
    expect(detail).toMatch(/minHeight: 44/);
    expect(gate).toMatch(/minHeight: 48/);
  });
});

describe("the client cannot write a score", () => {
  it("has no table write to any scoring table", () => {
    for (const table of [
      "team_member_edition_scores",
      "team_question_scores",
      "question_attempts",
      "teams",
      "team_members"
    ]) {
      expect(data, table).not.toMatch(
        new RegExp(`from\\("${table}"\\)[\\s\\S]{0,80}\\.(insert|update|upsert|delete)`)
      );
    }
  });

  it("routes every mutation through an RPC", () => {
    for (const rpc of [
      "set_player_identity",
      "create_team",
      "join_team_with_invite",
      "leave_team",
      "rotate_team_invite_code",
      "get_team_leaderboard"
    ]) {
      expect(data, rpc).toContain(rpc);
    }
  });

  it("writes only the two things a reader owns", () => {
    // Blocks and reports. Nothing else is a client-side insert.
    const writes = data.match(/\.from\("(\w+)"\)[\s\S]{0,120}?\.(insert|upsert|delete)/g) ?? [];

    for (const write of writes) {
      expect(write).toMatch(/user_blocks|user_reports/);
    }
  });

  it("never stores a signed URL as an avatar path", () => {
    expect(data).toContain("createSignedUrl");
    expect(data).not.toMatch(/avatar_path:\s*signed/i);
  });
});
