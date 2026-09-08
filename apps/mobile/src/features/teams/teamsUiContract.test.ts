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
const profileForm = stripComments(read("PlayerProfileForm.tsx"));
const create = stripComments(read("CreateTeamScreen.tsx"));
const joinScreen = stripComments(read("JoinTeamScreen.tsx"));
const manage = stripComments(read("TeamManageScreen.tsx"));
const membersScreen = stripComments(read("TeamMembersScreen.tsx"));
const invite = stripComments(read("TeamInviteScreen.tsx"));
const channel = stripComments(read("useTeamLeaderboardChannel.ts"));
const refetchOnReturn = stripComments(read("useRefetchOnReturn.ts"));
const data = stripComments(read("teamsData.ts"));
const countries = stripComments(read("countries.ts"));
const help = stripComments(read("HelpScreen.tsx"));
const avatar = stripComments(read("PlayerAvatar.tsx"));
const teamAvatarPolicy = stripComments(read("teamAvatarPolicy.ts"));
const teamAvatarUpload = stripComments(read("teamAvatarUpload.ts"));

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

  it("requires a username and a country, and never a photo", () => {
    // OBJECTIVE 2. Save is gated on the two fields Teams actually needs. The
    // photo is offered on the same card, labelled optional, and is absent from
    // canSubmit — so a reader who declines the photo library still reaches
    // their leaderboard.
    expect(profileForm).toMatch(/canSubmit\s*=\s*username\.trim\(\)\.length > 0/);
    expect(profileForm).not.toMatch(/canSubmit[\s\S]{0,120}hasPhoto/);
    expect(profileForm).toContain("copy.avatarOptional");
    expect(profileForm).not.toContain("copy.avatarRequired");
    // And the save path itself refuses nothing for a missing photo.
    expect(profileForm).not.toMatch(/if \(!hasPhoto\)/);
  });

  it("lets a reader take a photo off again, not only replace it", () => {
    // Removal is its own intent on the wire. The RPC COALESCEs its arguments so
    // that a partial update cannot erase a username, which means NULL says
    // "leave it alone" and cannot also say "remove it".
    expect(profileForm).toContain("copy.avatarRemove");
    expect(profileForm).toContain("removingAvatar");
    expect(profileForm).toContain("clearAvatar:");
    expect(data).toContain("p_clear_avatar");
    // And the bucket object goes only after the row has stopped pointing at it.
    expect(profileForm).toMatch(/savePlayerIdentity[\s\S]*deleteAvatarObject/);
  });

  it("asks for the photo library only on a tap, never on mount", () => {
    // A system dialog in front of somebody who has not yet said what they want
    // makes the refusal reflexive rather than informed, so nothing
    // picker-shaped may run from an effect.
    expect(profileForm).toContain("pickAndCompressAvatar");
    expect(profileForm).not.toMatch(/useEffect\([\s\S]{0,400}?(pickAndCompress|ImagePicker)/);
    expect(profileForm).not.toContain("requestMediaLibraryPermissionsAsync");
  });

  it("offers Settings when the refusal can no longer be reversed in-app", () => {
    // canAskAgain false means the OS will never show the dialog again, so a
    // Retry button would do nothing at all.
    expect(profileForm).toContain("canAskAgain");
    expect(profileForm).toContain("Linking.openSettings");
    expect(profileForm).toContain("copy.avatarPermissionOpenSettings");
  });

  it("treats the server as the authority on uniqueness", () => {
    // The local check is a courtesy; the write is the guard, and 23505 is the
    // race being reported rather than swallowed.
    expect(profileForm).toContain("isUsernameAvailable");
    expect(profileForm).toContain("savePlayerIdentity");
    expect(profileForm).toContain('result.error.code === "23505"');
    expect(profileForm).toContain("copy.usernameTaken");
  });

  it("asks for a country from a list and never from a sensor", () => {
    for (const forbidden of ["Location", "geolocation", "getCurrentPosition", "expo-location"]) {
      expect(profileForm, forbidden).not.toContain(forbidden);
      expect(countries, forbidden).not.toContain(forbidden);
    }

    expect(profileForm).toContain("searchCountries");
  });

  it("is the same form Account edits, so the rules cannot drift", () => {
    expect(gate).toContain("PlayerProfileForm");
    expect(stripComments(read("PlayerProfileScreen.tsx"))).toContain("PlayerProfileForm");
  });
});

describe("a screen you came back to is not a screen you left", () => {
  // Every one of these is a place the reader leaves in order to change
  // something and then returns to. A mount-only load would show them the world
  // as it was before they changed it: a Teams list without the Team they just
  // created, a header with the name they just replaced, a member count that
  // still includes somebody they just removed.
  const returners: [string, string][] = [
    ["the Teams list", landing],
    ["Team detail", detail],
    ["Manage", manage],
    ["Members", membersScreen]
  ];

  for (const [name, source] of returners) {
    it(`refetches when ${name} is returned to`, () => {
      expect(source).toContain("useRefetchOnReturn");
    });
  }

  it("does not pay for that with a second fetch on the way in", () => {
    // useFocusEffect fires on the first focus too, and again whenever its
    // callback identity changes — which for Team detail is every range switch.
    // The hook skips the first focus and holds the loader in a ref so its own
    // dependency list stays empty.
    expect(refetchOnReturn).toContain("hasFocusedOnce");
    expect(refetchOnReturn).toMatch(/useCallback\(\s*\(\)\s*=>\s*\{[\s\S]*?\},\s*\[\]\s*\)/);
    expect(refetchOnReturn).toContain("latest.current");
  });

  it("returns silently rather than flashing a spinner", () => {
    // The refetch must not reset the screen to its loading state: replacing a
    // drawn leaderboard with a spinner on every back tap is worse than a list
    // that updates a moment later.
    expect(refetchOnReturn).not.toContain('setStatus("loading")');
  });
});

describe("the Teams landing", () => {
  it("shows Your Teams, then Join, then Create", () => {
    // The returning reader came to see where they stand. The two acquisition
    // actions sit under a list that is a handful of private leagues and never a
    // feed, so neither is ever pushed far down the screen.
    expect(landing.indexOf("copy.yourTeams")).toBeLessThan(landing.indexOf("copy.join"));
  });

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
      ["gate", gate],
      ["profileForm", profileForm],
      ["create", create],
      ["join", joinScreen],
      ["manage", manage],
      ["members", membersScreen],
      ["invite", invite]
    ] as const) {
      expect(source, name).toContain("tokens.space");
      expect(source, name).toMatch(/useThemedStyles|useThemeColors/);
      expect(source, name).not.toMatch(/#[0-9a-f]{6}/i);
      expect(source, name).not.toMatch(/gradient|confetti|trophy|badge-gold/i);
    }
  });

  it("names the member every roster action would act on", () => {
    // The visible label stays one short verb — four of them under each card is
    // what keeps the roster readable — but VoiceOver reads the buttons as a
    // flat list, and "Block, button" repeated once per member says nothing
    // about whom it would block.
    for (const action of ["copy.report", "copy.transferOwnership", "copy.removeMember"]) {
      expect(membersScreen, action).toContain(`copy.actionFor(${action}, name)`);
    }

    // Block and Unblock are the same button, so its label follows the state.
    expect(membersScreen).toContain(
      "copy.actionFor(isBlocked ? copy.unblock : copy.block, name)"
    );

    for (const language of ["en", "fr"] as const) {
      expect(getTeamsCopy(language).actionFor("Report", "augustin")).toContain("augustin");
    }
  });

  it("keeps touch targets at 44pt or more", () => {
    expect(detail).toMatch(/minHeight: 44/);
    expect(profileForm).toMatch(/minHeight: 48/);

    for (const [name, source] of [
      ["create", create],
      ["join", joinScreen],
      ["manage", manage],
      ["members", membersScreen]
    ] as const) {
      expect(source, name).toMatch(/minHeight: (44|48|56)/);
    }
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

// ---------------------------------------------------------------------------
// A photo is optional, everywhere, for people and for Teams
// ---------------------------------------------------------------------------

describe("the avatar placeholder", () => {
  it("is one component, and both kinds of avatar are drawn by it", () => {
    // The same disc for a person and for a Team, so "no picture" cannot come to
    // mean two different things on two screens.
    expect(avatar).toMatch(/function AvatarFrame\(/);
    expect(avatar).toMatch(/export function PlayerAvatar\(/);
    expect(avatar).toMatch(/export function TeamAvatar\(/);
    expect(avatar).toMatch(/<AvatarFrame glyph="user"/);
    expect(avatar).toMatch(/<AvatarFrame glyph="users"/);
  });

  it("always renders something, and never a broken image", () => {
    // A signed URL that has not arrived, a moderated avatar, a blocked member
    // and a reader who simply never chose a photo all land on the same branch.
    expect(avatar).toMatch(/if \(url\) \{[\s\S]*?<Image/);
    expect(avatar).toMatch(/return \(\s*\n\s*<View accessible=\{false\} style=\{frame\}>/);
    expect(avatar).toContain("<Feather");
  });

  it("is a neutral disc from the palette, in both schemes", () => {
    expect(avatar).toContain("backgroundColor: c.surfaceMuted");
    expect(avatar).toContain("borderColor: c.border");
    expect(avatar).toContain("color={colors.mutedSoft}");
    expect(avatar).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/);
  });

  it("draws no initials", () => {
    // Two grey letters announce that something is missing, are unreadable at
    // 36pt for a name in a non-Latin script, and made a photo feel compulsory.
    // The name is beside the avatar in text on every surface that uses it.
    expect(avatar).not.toContain("initialsFor");

    const playerProfile = stripComments(read("playerProfile.ts"));

    expect(playerProfile).not.toContain("initialsFor");
  });

  it("is what every avatar surface in the app renders", () => {
    for (const [name, source] of [
      ["members", membersScreen],
      ["leaderboard", detail],
      ["profile form", profileForm]
    ] as const) {
      expect(source, name).toContain("<PlayerAvatar");
    }

    for (const [name, source] of [
      ["teams landing", landing],
      ["team detail", detail],
      ["manage", manage],
      ["invite", invite],
      ["create", create]
    ] as const) {
      expect(source, name).toContain("<TeamAvatar");
    }
  });
});

describe("a Team may have a photo, and usually will not", () => {
  it("never blocks creating a Team on one", () => {
    // Create sends the photo AFTER the team exists, because the storage path is
    // keyed by the team id — and a failure there leaves a working Team with no
    // picture rather than no Team.
    expect(create).toMatch(/createTeam\(name\.trim\(\)\)/);
    expect(create).toMatch(/createTeam[\s\S]*uploadTeamAvatar/);
    expect(create).toContain("copy.avatarOptional");
    // The create button is gated on the name and the games, never on a photo.
    expect(create).not.toMatch(/pendingPhoto[\s\S]{0,80}setError\(copy\.(gamesRequired|nameTooShort)\)/);
  });

  it("lets an owner add, replace and remove it from Manage", () => {
    expect(manage).toContain("copy.teamPhotoChoose");
    expect(manage).toContain("copy.teamPhotoChange");
    expect(manage).toContain("copy.teamPhotoRemove");
    expect(manage).toMatch(/onChooseTeamPhoto/);
    expect(manage).toMatch(/onRemoveTeamPhoto/);
    expect(manage).toContain("setTeamAvatar({ teamId, clear: true })");
    // The object is deleted only after the row has stopped pointing at it.
    expect(manage).toMatch(/setTeamAvatar[\s\S]*deleteTeamAvatarObject/);
  });

  it("shows the photo section to the owner only", () => {
    // The server refuses a member either way (42501); the screen does not offer
    // them a button that cannot work.
    expect(manage).toMatch(/team\.isOwner \? \(\s*\n\s*<>\s*\n\s*<Card padding="lg" style=\{styles\.card\}>\s*\n\s*<AppText color="muted" variant="caption">\s*\n\s*\{copy\.teamPhotoLabel\}/);
  });

  it("carries a null path through every read without special-casing it", () => {
    expect(data).toContain("avatarPath: typeof team.avatar_path === \"string\" ? team.avatar_path : null");
    expect(data).toContain("avatarPath: typeof row.avatar_path === \"string\" ? row.avatar_path : null");
    expect(data).toContain("avatar_path,is_owner,status");
  });
});

describe("a team avatar and a player avatar are different permissions", () => {
  it("live in different buckets", () => {
    expect(teamAvatarPolicy).toContain('export const TEAM_AVATAR_BUCKET = "team-avatars"');
    expect(teamAvatarUpload).toContain("from(TEAM_AVATAR_BUCKET)");

    const upload = stripComments(read("avatarUpload.ts"));

    expect(upload).toContain('from("avatars")');
    expect(upload).not.toContain("team-avatars");
  });

  it("key the path on the thing that owns the object", () => {
    // The first path segment IS the permission: Storage compares it against
    // auth.uid() for a person and against is_team_owner() for a Team.
    expect(teamAvatarPolicy).toContain("`${input.teamId}/${input.fileId}.jpg`");
    expect(teamAvatarPolicy).toContain("teamOfAvatarPath(input.path) === input.teamId");
  });

  it("share the size budget rather than restating it", () => {
    // One answer to "how many bytes may a 40pt disc cost", not two that drift.
    expect(teamAvatarPolicy).toContain('} from "./avatarPolicy"');
    expect(teamAvatarPolicy).not.toMatch(/=\s*\d+\s*\*\s*1024/);
  });

  it("never reach for the service role from the phone", () => {
    for (const [name, source] of [
      ["team avatar upload", teamAvatarUpload],
      ["team avatar policy", teamAvatarPolicy],
      ["teams data", data]
    ] as const) {
      expect(source, name).not.toMatch(/service_role|SERVICE_ROLE|serviceRole/);
    }
  });

  it("cache signed URLs per bucket, so one cannot serve the other", () => {
    const urls = stripComments(read("useAvatarUrl.ts"));

    expect(urls).toContain("function keyFor(bucket: Bucket, path: string)");
    expect(urls).toContain("`${bucket}:${path}`");
  });
});

describe("the identity RPC call is unambiguous", () => {
  it("always sends all four arguments, including p_clear_avatar: false", () => {
    // The database serves two overloads — the canonical four and a three-
    // argument wrapper kept alive for the build already on people's phones —
    // and PostgREST picks between them by the set of argument NAMES in the
    // body. Omitting p_clear_avatar when it is false would silently route the
    // call to the old wrapper, which cannot remove a photo, and "Remove" would
    // do nothing with no error to show for it.
    expect(data).toMatch(
      /\.rpc\("set_player_identity", \{[\s\S]*?p_username:[\s\S]*?p_country_code:[\s\S]*?p_avatar_path:[\s\S]*?p_clear_avatar: input\.clearAvatar === true[\s\S]*?\}\)/
    );
    // Never conditional, never spread: a key that can be absent is the bug.
    expect(data).not.toMatch(/\.\.\.\([\s\S]{0,80}p_clear_avatar/);
  });

  it("is typed so omitting the flag cannot compile", () => {
    const types = readFileSync(
      join(teamsDir, "..", "..", "types", "database.ts"),
      "utf8"
    );
    const signature = types.slice(
      types.indexOf("set_player_identity: {"),
      types.indexOf("is_username_available")
    );

    expect(signature).toContain("p_clear_avatar: boolean;");
    expect(signature).not.toContain("p_clear_avatar?:");
  });
});
