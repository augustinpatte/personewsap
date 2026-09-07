import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { COUNTRIES, countryName, findCountry, searchCountries } from "./countries";
import { INVITE_CODE_LENGTH, isCompleteInviteCode, normalizeInviteCode } from "./inviteCode";
import { editionStatus, rankLeaderboard } from "./leaderboard";
import {
  EMPTY_DRAFT,
  MAX_ARTICLES_PER_TOPIC,
  MINI_CASE_TOPIC_CHOICES,
  NEWSLETTER_TOPIC_CHOICES,
  draftEditionShape,
  draftHasAGame,
  draftToNewsletterTopics,
  setNewsletterArticleCount,
  toggleMiniCaseTopic,
  toggleNewsletterTopic
} from "./teamConfigOptions";
import { getTeamsCopy, statusLabel } from "./teamsCopy";

/**
 * The rules a reader meets between "open Teams" and "see a leaderboard".
 *
 * Everything here is a decision the product made that a screenshot cannot show:
 * which countries exist, how many articles a topic may contribute, what a code
 * with a space in it means, and what a Team is told about when its scoring
 * starts.
 */

const read = (name: string) => readFileSync(join(__dirname, name), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the country list", () => {
  it("carries every officially assigned ISO 3166-1 alpha-2 code", () => {
    // The previous fifty-entry list was a guess about where readers come from,
    // and a reader from a country nobody guessed could not finish a profile
    // Teams now requires.
    expect(COUNTRIES).toHaveLength(249);

    for (const country of COUNTRIES) {
      expect(country.code, country.code).toMatch(/^[A-Z]{2}$/);
      expect(country.nameEn.length, country.code).toBeGreaterThan(1);
      expect(country.nameFr.length, country.code).toBeGreaterThan(1);
    }
  });

  it("has no duplicate codes", () => {
    expect(new Set(COUNTRIES.map((country) => country.code)).size).toBe(COUNTRIES.length);
  });

  it("finds every country by its own code", () => {
    for (const country of COUNTRIES) {
      expect(findCountry(country.code)?.code, country.code).toBe(country.code);
      expect(findCountry(country.code.toLowerCase())?.code, country.code).toBe(country.code);
    }
  });

  it("finds every country by its name, in both languages", () => {
    for (const country of COUNTRIES) {
      for (const language of ["en", "fr"] as const) {
        const results = searchCountries(countryName(country, language), language);
        expect(
          results.some((entry) => entry.code === country.code),
          `${country.code}/${language}`
        ).toBe(true);
      }
    }
  });

  it("searches the other language too", () => {
    // A French reader who types "Germany" means Germany. Refusing them because
    // the interface is in French would be a puzzle rather than a picker.
    expect(searchCountries("Germany", "fr")[0].code).toBe("DE");
    expect(searchCountries("Allemagne", "en")[0].code).toBe("DE");
  });

  it("ignores accents and case", () => {
    expect(searchCountries("etats", "fr").some((entry) => entry.code === "US")).toBe(true);
    expect(searchCountries("COTE D IVOIRE", "fr").some((entry) => entry.code === "CI")).toBe(true);
  });

  it("puts the exact code first", () => {
    // "in" must offer India before Argentina.
    expect(searchCountries("IN", "en")[0].code).toBe("IN");
    expect(searchCountries("FR", "fr")[0].code).toBe("FR");
  });

  it("opens showing the whole list rather than nothing", () => {
    expect(searchCountries("", "en")).toHaveLength(COUNTRIES.length);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(searchCountries("zzzzzz", "en")).toEqual([]);
  });

  it("asks no sensor for any of it", () => {
    // Comments stripped: the module documents the absence of geolocation, and
    // matching that prose would be the test failing on its own explanation.
    const source = stripComments(read("countries.ts"));

    for (const forbidden of ["expo-location", "getCurrentPosition", "geolocation"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });
});

describe("a Team's configuration", () => {
  it("offers the eight product topics and the six mini-case topics", () => {
    expect(NEWSLETTER_TOPIC_CHOICES.map((choice) => choice.topicId).sort()).toEqual(
      [
        "business",
        "culture_media",
        "engineering",
        "finance",
        "law",
        "medicine",
        "sport_business",
        "tech_ai"
      ].sort()
    );

    expect(MINI_CASE_TOPIC_CHOICES).toHaveLength(6);
  });

  it("starts a selected topic at one article", () => {
    const draft = toggleNewsletterTopic(EMPTY_DRAFT, "finance");

    expect(draft.newsletter.finance).toBe(1);
    expect(draftToNewsletterTopics(draft)).toEqual([{ topicId: "finance", articlesCount: 1 }]);
  });

  it("allows two", () => {
    const draft = setNewsletterArticleCount(
      toggleNewsletterTopic(EMPTY_DRAFT, "finance"),
      "finance",
      2
    );

    expect(draft.newsletter.finance).toBe(2);
  });

  it("cannot reach three", () => {
    // An edition publishes at most two articles per topic, and the CHECK
    // constraint on team_config_newsletter_topics refuses anything else — so
    // three is clamped here rather than sent and rejected as a 22023 nobody
    // can read.
    const draft = setNewsletterArticleCount(
      toggleNewsletterTopic(EMPTY_DRAFT, "finance"),
      "finance",
      3
    );

    expect(draft.newsletter.finance).toBe(MAX_ARTICLES_PER_TOPIC);
    expect(draftToNewsletterTopics(draft)[0].articlesCount).toBe(2);
    expect(MAX_ARTICLES_PER_TOPIC).toBe(2);
  });

  it("clamps a zero or a negative just as hard", () => {
    const draft = setNewsletterArticleCount(
      toggleNewsletterTopic(EMPTY_DRAFT, "finance"),
      "finance",
      0
    );

    expect(draft.newsletter.finance).toBe(1);
  });

  it("ignores a count for a topic that is not selected", () => {
    expect(setNewsletterArticleCount(EMPTY_DRAFT, "finance", 2)).toEqual(EMPTY_DRAFT);
  });

  it("toggles a topic off again", () => {
    const on = toggleNewsletterTopic(EMPTY_DRAFT, "finance");
    expect(toggleNewsletterTopic(on, "finance").newsletter).toEqual({});
  });

  it("selects several mini-case topics", () => {
    const draft = toggleMiniCaseTopic(toggleMiniCaseTopic(EMPTY_DRAFT, "ai"), "law_compliance");

    expect(draft.miniCases).toEqual(["ai", "law_compliance"]);
    expect(toggleMiniCaseTopic(draft, "ai").miniCases).toEqual(["law_compliance"]);
  });

  it("requires at least one game overall, not one of each", () => {
    // A Team that wants only mini cases is a coherent choice. A Team that chose
    // nothing would publish an empty edition and score everybody zero forever.
    expect(draftHasAGame(EMPTY_DRAFT)).toBe(false);
    expect(draftHasAGame(toggleMiniCaseTopic(EMPTY_DRAFT, "ai"))).toBe(true);
    expect(draftHasAGame(toggleNewsletterTopic(EMPTY_DRAFT, "finance"))).toBe(true);
  });

  it("counts what an edition of the Team would carry", () => {
    const draft = toggleMiniCaseTopic(
      setNewsletterArticleCount(toggleNewsletterTopic(EMPTY_DRAFT, "finance"), "finance", 2),
      "ai"
    );

    expect(draftEditionShape(draft)).toEqual({ articles: 2, miniCases: 1 });
  });

  it("is refused by Create and by Manage when nothing is selected", () => {
    for (const screen of ["CreateTeamScreen.tsx", "TeamManageScreen.tsx"]) {
      expect(read(screen), screen).toContain("draftHasAGame");
      expect(read(screen), screen).toContain("copy.gamesRequired");
    }
  });
});

describe("an invite code", () => {
  it("survives the way people actually paste one", () => {
    expect(normalizeInviteCode(" abcd 2345 ")).toBe("ABCD2345");
    expect(normalizeInviteCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizeInviteCode("ABCD2345\n")).toBe("ABCD2345");
  });

  it("never grows past eight characters", () => {
    expect(normalizeInviteCode("ABCD2345EXTRA")).toHaveLength(INVITE_CODE_LENGTH);
  });

  it("knows when it is not a code yet", () => {
    expect(isCompleteInviteCode("ABCD234")).toBe(false);
    expect(isCompleteInviteCode("abcd2345")).toBe(true);
    expect(isCompleteInviteCode("")).toBe(false);
  });
});

describe("joining", () => {
  const join = read("JoinTeamScreen.tsx");
  const data = read("teamsData.ts");

  it("gives one answer for a missing, archived or closed code", () => {
    // Eight characters is a small enough space that a distinct "that Team is
    // archived" would confirm a hit and let somebody map the code space by the
    // difference in the replies. The server answers uniformly; the screen does
    // not undo that by guessing which failure it was.
    expect(join).toContain("copy.joinNotFound");
    expect(join).not.toContain("copy.joinArchived");
    expect(data).toContain('error.code === "P0002"');
  });

  it("treats an existing membership as a destination, not an error", () => {
    expect(join).toContain("copy.joinAlreadyMember");
    expect(join).toContain("copy.openTeam");
    expect(data).toContain("already_member");
  });

  it("does not auto-submit a code that arrived through a link", () => {
    // A tap on a link in a group chat is not a decision to join a league.
    expect(join).toContain("useLocalSearchParams");
    expect(join).not.toMatch(/useEffect\([\s\S]{0,300}?joinTeamWithCode/);
  });

  it("says the reader starts with the next edition", () => {
    expect(join).toContain("copy.startsNextEdition");
  });
});

describe("what a Team is told about when scoring starts", () => {
  it("says plainly that the current edition does not count", () => {
    for (const language of ["en", "fr"] as const) {
      const copy = getTeamsCopy(language);

      expect(copy.startsNextEditionCreated).toMatch(
        language === "fr" ? /prochaine édition/ : /next edition/
      );
    }

    // The French is written as French, not translated from the English.
    expect(getTeamsCopy("fr").startsNextEditionCreated).toBe(
      "Les scores commenceront à la prochaine édition."
    );
  });

  it("is shown right after Create", () => {
    expect(read("TeamInviteScreen.tsx")).toContain("copy.startsNextEditionCreated");
    expect(read("CreateTeamScreen.tsx")).toContain("copy.startsNextEditionCreated");
  });

  it("is not shown to an owner fetching the code for a Team already running", () => {
    // The invite screen is reached two ways: straight out of Create, and from
    // Manage weeks later. Telling the second reader their Team starts scoring
    // next edition would be false about a Team that has been scoring since.
    const invite = read("TeamInviteScreen.tsx");
    const createdBranch = invite.slice(
      invite.indexOf("{justCreated ? ("),
      invite.indexOf("copy.inviteBody")
    );

    expect(createdBranch).toContain("copy.startsNextEditionCreated");
    expect(invite.slice(invite.indexOf("copy.inviteBody"))).not.toContain(
      "copy.startsNextEditionCreated"
    );
  });

  it("shows the server's effective date on a configuration change", () => {
    // The date is the one update_team_config returned, never one the screen
    // computed and hoped matched.
    const manage = read("TeamManageScreen.tsx");

    expect(manage).toContain("result.data.effectiveFromEdition");
    expect(manage).toContain("copy.effectiveFrom");
  });

  it("never renders a mid-edition joiner as somebody who did not bother", () => {
    const copy = getTeamsCopy("en");

    expect(statusLabel("starts_next_edition", copy)).toBe(copy.statusStartsNextEdition);
    expect(statusLabel("starts_next_edition", copy)).not.toBe(copy.statusNotStarted);
  });

  it("carries the server's verdict over any arithmetic on the counts", () => {
    // Both are 0 of 0; only the server knows eligible_from_edition.
    expect(
      editionStatus({ answeredCount: 0, assignedCount: 0, status: "starts_next_edition" })
    ).toBe("starts_next_edition");
    expect(editionStatus({ answeredCount: 0, assignedCount: 0 })).toBe("not_started");
  });
});

describe("owner actions", () => {
  const manage = read("TeamManageScreen.tsx");
  const members = read("TeamMembersScreen.tsx");
  const invite = read("TeamInviteScreen.tsx");
  const data = read("teamsData.ts");

  it("routes rename, config, archive and leave through the server", () => {
    for (const rpc of ["rename_team", "update_team_config", "archive_team", "leave_team"]) {
      expect(data, rpc).toContain(rpc);
    }

    for (const action of ["renameTeam", "saveTeamConfig", "archiveTeam", "leaveTeam"]) {
      expect(manage, action).toContain(action);
    }
  });

  it("manages the invite: share, rotate, disable, re-enable", () => {
    expect(invite).toContain("rotateInviteCode");
    expect(invite).toContain("setInviteOpen");
    expect(invite).toContain("Share.share");
    expect(invite).toContain("copy.inviteDisable");
    expect(invite).toContain("copy.inviteEnable");
  });

  it("shows a non-owner that invites are not theirs to manage", () => {
    expect(invite).toContain("copy.manageOwnerOnly");
  });

  it("removes and transfers behind a confirmation, and never removes the owner", () => {
    expect(members).toContain("removeTeamMember");
    expect(members).toContain("transferTeamOwnership");
    expect(members).toMatch(/Alert\.alert\([\s\S]{0,200}copy\.removeMemberConfirm/);
    expect(members).toMatch(/Alert\.alert\([\s\S]{0,200}copy\.transferConfirmBody/);
    expect(members).toContain('member.role !== "owner"');
  });

  it("makes an owner with company transfer before leaving", () => {
    // Leaving, handing over and archiving are three different decisions, and
    // the server refuses to take all three at once.
    expect(manage).toContain("transfer_required");
    expect(manage).toContain("copy.ownerMustTransfer");
  });

  it("confirms before archiving and says what survives it", () => {
    expect(manage).toMatch(/Alert\.alert\(copy\.archiveTitle/);

    for (const language of ["en", "fr"] as const) {
      expect(getTeamsCopy(language).archiveConfirm.length).toBeGreaterThan(20);
    }

    expect(getTeamsCopy("en").archiveConfirm).toMatch(/Past results stay/);
    expect(getTeamsCopy("fr").archiveConfirm).toMatch(/résultats passés restent/);
  });
});

describe("the leaderboard row", () => {
  const member = (over: Partial<Parameters<typeof rankLeaderboard>[0]["members"][number]>) => ({
    userId: "a",
    username: "a",
    countryCode: "FR",
    avatarPath: null,
    scoreMilli: 0,
    answeredCount: 0,
    assignedCount: 0,
    editionsCompleted: 0,
    ...over
  });

  it("shows everybody, including the people who have not started", () => {
    const rows = rankLeaderboard({
      members: [
        member({ userId: "a", scoreMilli: 1800, answeredCount: 2, assignedCount: 2 }),
        member({ userId: "b" })
      ],
      selfUserId: "a"
    });

    expect(rows).toHaveLength(2);
    expect(rows[1].status).toBe("not_started");
  });

  it("keeps a blocked member's score and drops only their identity", () => {
    const rows = rankLeaderboard({
      members: [member({ userId: "a", scoreMilli: 1800 })],
      selfUserId: "z",
      blockedUserIds: new Set(["a"])
    });

    expect(rows[0].isBlocked).toBe(true);
    expect(rows[0].scoreMilli).toBe(1800);
  });

  it("has no divisions, tiers or medals anywhere in its copy", () => {
    for (const language of ["en", "fr"] as const) {
      const copy = JSON.stringify(getTeamsCopy(language)).toLowerCase();

      for (const forbidden of ["bronze", "silver", "argent", "division", "trophy", "trophée"]) {
        expect(copy, `${language}/${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
