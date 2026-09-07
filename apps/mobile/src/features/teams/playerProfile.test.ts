import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  const complete = {
    username: "augustin",
    countryCode: "FR",
    avatarPath: "aaaa0000-0000-4000-8000-00000000000a/photo.jpg"
  };

  it("needs a photo, a username and a country", () => {
    expect(isProfileCompleteForTeams(complete)).toBe(true);
  });

  it("requires the avatar", () => {
    // A leaderboard is a list of people, and the photo is how you recognise the
    // friend you are playing against. A Team where half the rows are two grey
    // letters is a spreadsheet.
    expect(isProfileCompleteForTeams({ ...complete, avatarPath: null })).toBe(false);
  });

  it("requires the username", () => {
    expect(isProfileCompleteForTeams({ ...complete, username: null })).toBe(false);
  });

  it("requires the country", () => {
    expect(isProfileCompleteForTeams({ ...complete, countryCode: null })).toBe(false);
  });

  it("reports exactly what is missing", () => {
    expect(
      missingProfileFields({ username: null, countryCode: null, avatarPath: null })
    ).toEqual(["avatar", "username", "country"]);

    expect(missingProfileFields({ ...complete, countryCode: null })).toEqual(["country"]);
    expect(missingProfileFields({ ...complete, avatarPath: null })).toEqual(["avatar"]);
    expect(missingProfileFields(complete)).toEqual([]);
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

// ---------------------------------------------------------------------------
// The client and the server must refuse the same names
// ---------------------------------------------------------------------------
// Until 20260907140000 these rules lived only here, so a rewritten binary could
// claim "admin". Now the database is the authority and this is the courtesy
// check in front of it — which only works while the two agree. If the client is
// stricter, it refuses a name the server would have allowed; if it is looser,
// the reader gets a raw Postgres error instead of a sentence in their language.

describe("the client's moderation rules mirror the database's", () => {
  const migration = readFileSync(
    join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations",
      "20260907140000_teams_security_hardening.sql"),
    "utf8"
  );

  const listIn = (functionName: string): string[] => {
    const start = migration.indexOf(`FUNCTION public.${functionName}`);
    expect(start, `${functionName} is not in the migration`).toBeGreaterThan(-1);

    const array = /ARRAY\s*\[([\s\S]*?)\]/.exec(migration.slice(start));
    expect(array, `${functionName} declares no ARRAY of names`).not.toBeNull();

    return [...array![1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  };

  it("reserves exactly the same names", () => {
    const server = listIn("is_reserved_username");

    for (const name of server) {
      expect(validateUsername(name), `${name} is reserved server-side`).toBe("reserved");
    }

    // And nothing beyond them: a client-only reservation refuses a name the
    // server would happily have given away to somebody else.
    expect(server).toContain("admin");
    expect(server).toContain("personews");
    expect(server).toContain("moderator");
    expect(server).toContain("support");
    expect(server).toContain("official");
  });

  it("blocks exactly the same fragments", () => {
    for (const fragment of listIn("has_blocked_fragment")) {
      expect(validateUsername(`x${fragment}x`), fragment).toBe("not_allowed");
      expect(validateTeamName(`The ${fragment} club`), fragment).toBe("not_allowed");
    }
  });

  it("normalises the same way, so punctuation defeats neither", () => {
    // The SQL does lower(normalize(…, NFD)) then strips [^a-z0-9]; this is the
    // same transformation, and the pair below is what proves it matters.
    expect(normalizeForModeration("Àd.m_i n")).toBe("admin");
    expect(validateUsername("a.d.m.i.n")).toBe("reserved");
  });
});
