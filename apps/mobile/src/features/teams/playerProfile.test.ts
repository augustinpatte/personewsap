import { describe, expect, it } from "vitest";

import {
  initialsFor,
  isProfileCompleteForTeams,
  missingProfileFields,
  normalizeCountryCode,
  normalizeForModeration,
  validateTeamName,
  validateUsername
} from "./playerProfile";

/**
 * The identity a leaderboard row needs.
 *
 * The rule with the widest blast radius is the one about where the gate is:
 * only Teams. A reader who never opens that tab never picks a username, and
 * every other screen in the app has to keep working with `username = NULL`.
 */

describe("username validation", () => {
  it("accepts ordinary names", () => {
    for (const name of ["augustin", "aug_2026", "a.p.patte", "Player1", "abc"]) {
      expect(validateUsername(name), name).toBeNull();
    }
  });

  it("enforces the same length the column does", () => {
    expect(validateUsername("ab")).toBe("too_short");
    expect(validateUsername("a".repeat(21))).toBe("too_long");
    expect(validateUsername("a".repeat(20))).toBeNull();
  });

  it("refuses names the database CHECK would refuse", () => {
    // A client that accepted one of these would produce a 23514 nobody can read.
    for (const name of [".augustin", "augustin.", "_aug", "aug_", "aug ustin", "aug-ustin", "augüstin"]) {
      expect(validateUsername(name), name).toBe("invalid_characters");
    }
  });

  it("refuses impersonation of the product and of moderation", () => {
    for (const name of ["personews", "PersoNewsAP", "admin", "Moderator", "support"]) {
      expect(validateUsername(name), name).toBe("reserved");
    }
  });

  it("stops the laziest abuse without shipping a slur dictionary", () => {
    expect(validateUsername("fuckthis")).toBe("not_allowed");
    expect(validateUsername("n.i.g.g.a")).toBe("not_allowed");
  });

  it("does not reject ordinary names that merely look suspicious", () => {
    // A word list produces false positives that insult real people. These must
    // pass.
    for (const name of ["scunthorpe", "assange", "Shitake" .replace("Shit", "Shiit"), "Cassidy"]) {
      expect(validateUsername(name), name).toBeNull();
    }
  });

  it("trims before judging", () => {
    expect(validateUsername("  augustin  ")).toBeNull();
  });
});

describe("normalizeForModeration", () => {
  it("defeats padding and accents", () => {
    expect(normalizeForModeration("A.u_g-u s t i n")).toBe("augustin");
    expect(normalizeForModeration("Augüstin")).toBe("augustin");
  });
});

describe("team name validation", () => {
  it("accepts a normal league name", () => {
    expect(validateTeamName("Loyola Finance")).toBeNull();
    expect(validateTeamName("Tennis Team 2026")).toBeNull();
  });

  it("enforces the column's bounds", () => {
    expect(validateTeamName("a")).toBe("too_short");
    expect(validateTeamName("a".repeat(41))).toBe("too_long");
  });

  it("allows spaces and punctuation a username cannot have", () => {
    // A team name is a title, not a handle.
    expect(validateTeamName("L'équipe de Marie & Paul")).toBeNull();
  });
});

describe("country", () => {
  it("is an ISO alpha-2 code, uppercased", () => {
    expect(normalizeCountryCode("fr")).toBe("FR");
    expect(normalizeCountryCode(" us ")).toBe("US");
  });

  it("refuses anything that is not two letters", () => {
    // Never a coordinate, never a city, never an IP-derived guess.
    for (const value of ["FRA", "f", "48.85,2.35", "Paris", ""]) {
      expect(normalizeCountryCode(value), value).toBeNull();
    }
  });
});

describe("the Teams gate", () => {
  it("needs a username and a country", () => {
    expect(
      isProfileCompleteForTeams({ username: "augustin", countryCode: "FR", avatarPath: null })
    ).toBe(true);
  });

  it("does not require an avatar", () => {
    // A leaderboard renders initials perfectly well. Forcing a photo upload
    // before somebody can join their friends' league is a wall in front of the
    // one screen they were trying to reach.
    expect(
      isProfileCompleteForTeams({ username: "augustin", countryCode: "FR", avatarPath: null })
    ).toBe(true);
  });

  it("reports exactly what is missing", () => {
    expect(
      missingProfileFields({ username: null, countryCode: null, avatarPath: null })
    ).toEqual(["username", "country"]);

    expect(
      missingProfileFields({ username: "augustin", countryCode: null, avatarPath: null })
    ).toEqual(["country"]);
  });

  it("treats a reader who never opened Teams as incomplete, not as broken", () => {
    // This is the state of every existing reader. It must be an ordinary
    // "not yet" rather than anything that could surface elsewhere in the app.
    const untouched = { username: null, countryCode: null, avatarPath: null };

    expect(isProfileCompleteForTeams(untouched)).toBe(false);
    expect(() => missingProfileFields(untouched)).not.toThrow();
  });
});

describe("fallback initials", () => {
  it("always returns something a row can render", () => {
    expect(initialsFor("augustin")).toBe("AU");
    expect(initialsFor("aug.patte")).toBe("AP");
    expect(initialsFor("a")).toBe("A");
  });

  it("survives a missing or moderated name", () => {
    expect(initialsFor(null)).toBe("?");
    expect(initialsFor("   ")).toBe("?");
  });
});
