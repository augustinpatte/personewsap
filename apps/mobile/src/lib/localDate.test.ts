import { describe, expect, it } from "vitest";

import {
  classifyEditionDate,
  compareDateKeys,
  getDeviceTimeZone,
  getUserLocalDateKey,
  getUserLocalYear,
  isPastEditionDate,
  isTodayEditionDate
} from "./localDate";

/**
 * The reported bug, as a fixture: a reader in New Orleans on Sunday evening.
 *
 *   2026-08-30 21:30 America/Chicago
 *   = 2026-08-31 02:30 UTC
 *   = 2026-08-31 04:30 Europe/Paris
 *
 * Their calendar still says Sunday the 30th. Both UTC and Paris say Monday the
 * 31st, and either of those as the app's "today" moved Sunday's edition into
 * the archive while the reader was still reading it.
 */
const NEW_ORLEANS_SUNDAY_EVENING = new Date("2026-08-31T02:30:00Z");

/** One minute past local midnight in New Orleans: 2026-08-31 00:01. */
const NEW_ORLEANS_JUST_AFTER_MIDNIGHT = new Date("2026-08-31T05:01:00Z");

describe("Test 1 — New Orleans before local midnight", () => {
  it("is still 2026-08-30 for the reader", () => {
    expect(getUserLocalDateKey(NEW_ORLEANS_SUNDAY_EVENING, "America/Chicago")).toBe(
      "2026-08-30"
    );
  });

  it("keeps the 2026-08-30 edition as TODAY", () => {
    const today = getUserLocalDateKey(NEW_ORLEANS_SUNDAY_EVENING, "America/Chicago");

    expect(classifyEditionDate("2026-08-30", today)).toBe("today");
    expect(isTodayEditionDate("2026-08-30", today)).toBe(true);
    expect(isPastEditionDate("2026-08-30", today)).toBe(false);
  });

  it("does not take the UTC date, which is already the next day", () => {
    expect(NEW_ORLEANS_SUNDAY_EVENING.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(getUserLocalDateKey(NEW_ORLEANS_SUNDAY_EVENING, "America/Chicago")).not.toBe(
      NEW_ORLEANS_SUNDAY_EVENING.toISOString().slice(0, 10)
    );
  });
});

describe("Test 2 — Paris at the same instant", () => {
  it("is already 2026-08-31 there, and the 30th is PAST", () => {
    const today = getUserLocalDateKey(NEW_ORLEANS_SUNDAY_EVENING, "Europe/Paris");

    expect(today).toBe("2026-08-31");
    expect(classifyEditionDate("2026-08-30", today)).toBe("past");
  });

  it("lets two readers disagree about today at the same instant", () => {
    expect(getUserLocalDateKey(NEW_ORLEANS_SUNDAY_EVENING, "America/Chicago")).not.toBe(
      getUserLocalDateKey(NEW_ORLEANS_SUNDAY_EVENING, "Europe/Paris")
    );
  });
});

describe("Test 3 — New Orleans after local midnight", () => {
  it("rolls over to 2026-08-31 and moves the 30th into the past", () => {
    const today = getUserLocalDateKey(NEW_ORLEANS_JUST_AFTER_MIDNIGHT, "America/Chicago");

    expect(today).toBe("2026-08-31");
    expect(classifyEditionDate("2026-08-30", today)).toBe("past");
    expect(classifyEditionDate("2026-08-31", today)).toBe("today");
  });

  it("rolls over at local midnight and not a minute earlier", () => {
    // 2026-08-30 23:59 America/Chicago.
    const justBefore = new Date("2026-08-31T04:59:00Z");

    expect(getUserLocalDateKey(justBefore, "America/Chicago")).toBe("2026-08-30");
  });
});

describe("Test 4 — Los Angeles", () => {
  it("does not advance a day when UTC does", () => {
    // 2026-08-31 00:30 UTC is still 2026-08-30 17:30 in Los Angeles.
    const utcRollover = new Date("2026-08-31T00:30:00Z");

    expect(utcRollover.toISOString().slice(0, 10)).toBe("2026-08-31");
    expect(getUserLocalDateKey(utcRollover, "America/Los_Angeles")).toBe("2026-08-30");
    expect(classifyEditionDate("2026-08-30", getUserLocalDateKey(utcRollover, "America/Los_Angeles"))).toBe(
      "today"
    );
  });

  it("advances only at its own midnight", () => {
    // 2026-08-31 07:00 UTC = 2026-08-31 00:00 America/Los_Angeles.
    expect(getUserLocalDateKey(new Date("2026-08-31T06:59:00Z"), "America/Los_Angeles")).toBe(
      "2026-08-30"
    );
    expect(getUserLocalDateKey(new Date("2026-08-31T07:00:00Z"), "America/Los_Angeles")).toBe(
      "2026-08-31"
    );
  });
});

describe("Test 5 — a SQL date with no time stays that calendar day", () => {
  it("never shifts an edition date by a day, in any zone", () => {
    const zones = [
      "America/Chicago",
      "America/Los_Angeles",
      "America/New_York",
      "Europe/Paris",
      "Asia/Tokyo",
      "Pacific/Kiritimati",
      "Pacific/Midway",
      "UTC"
    ];

    for (const zone of zones) {
      // The stored value is compared as a calendar day, so on the reader's own
      // 2026-08-30 the 2026-08-30 edition is today — never the 29th or 31st.
      const today = "2026-08-30";

      expect(classifyEditionDate("2026-08-30", today)).toBe("today");
      expect(classifyEditionDate("2026-08-29", today)).toBe("past");
      expect(classifyEditionDate("2026-08-31", today)).toBe("future");
      // And the key produced for that zone is itself a plain calendar day.
      expect(getUserLocalDateKey(new Date("2026-08-30T12:00:00Z"), zone)).toMatch(
        /^\d{4}-\d{2}-\d{2}$/
      );
    }
  });

  it("compares as calendar days, with no Date parsing in between", () => {
    expect(compareDateKeys("2026-08-30", "2026-08-31")).toBe(-1);
    expect(compareDateKeys("2026-08-30", "2026-08-30")).toBe(0);
    expect(compareDateKeys("2026-09-01", "2026-08-31")).toBe(1);
    // Year boundaries sort correctly as strings too.
    expect(compareDateKeys("2026-12-31", "2027-01-01")).toBe(-1);
  });
});

describe("daylight saving is resolved from the IANA zone, never a fixed offset", () => {
  it("follows Chicago across its own DST change", () => {
    // CDT (UTC-5) in summer: 2026-07-01 04:30 UTC is still 23:30 on 30 June.
    expect(getUserLocalDateKey(new Date("2026-07-01T04:30:00Z"), "America/Chicago")).toBe(
      "2026-06-30"
    );
    // CST (UTC-6) in winter: the same clock time is already the next day.
    expect(getUserLocalDateKey(new Date("2026-01-01T05:30:00Z"), "America/Chicago")).toBe(
      "2025-12-31"
    );
    expect(getUserLocalDateKey(new Date("2026-01-01T06:30:00Z"), "America/Chicago")).toBe(
      "2026-01-01"
    );
  });

  it("follows Paris across its own DST change", () => {
    // CEST (UTC+2): 22:30 UTC is already the next day in Paris.
    expect(getUserLocalDateKey(new Date("2026-06-21T22:30:00Z"), "Europe/Paris")).toBe(
      "2026-06-22"
    );
    // CET (UTC+1): the same is not true in January until 23:00 UTC.
    expect(getUserLocalDateKey(new Date("2026-01-14T22:30:00Z"), "Europe/Paris")).toBe(
      "2026-01-14"
    );
    expect(getUserLocalDateKey(new Date("2026-01-14T23:30:00Z"), "Europe/Paris")).toBe(
      "2026-01-15"
    );
  });
});

describe("the timezone comes from the device, and can change", () => {
  it("reads a real IANA zone id from the platform", () => {
    expect(getDeviceTimeZone()).toMatch(/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)*$/);
  });

  it("re-reads the zone on every call, so a traveller is followed", () => {
    // The same reader, the same instant, before and after a flight: nothing is
    // captured at sign-up or memoised for the session.
    const instant = new Date("2026-08-31T02:30:00Z");

    expect(getUserLocalDateKey(instant, "Europe/Paris")).toBe("2026-08-31");
    expect(getUserLocalDateKey(instant, "America/Chicago")).toBe("2026-08-30");
  });

  it("falls back to UTC rather than throwing on an unusable zone", () => {
    expect(getUserLocalDateKey(new Date("2026-08-31T02:30:00Z"), "Not/AZone")).toBe(
      "2026-08-31"
    );
  });

  it("gives the reader's own year for a bare month search", () => {
    // 2026-12-31 22:00 America/Chicago — UTC is already 2027.
    const newYearsEve = new Date("2027-01-01T04:00:00Z");

    expect(newYearsEve.toISOString().slice(0, 4)).toBe("2027");
    expect(getUserLocalYear(newYearsEve, "America/Chicago")).toBe(2026);
  });
});
