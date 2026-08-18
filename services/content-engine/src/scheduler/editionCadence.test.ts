import { describe, expect, it } from "vitest";

import {
  getProductEditionDate,
  isEditionDay,
  nextEditionDate,
  parseForcedEditionType,
  PRODUCT_TIME_ZONE,
  resolveEditionType
} from "./editionCadence.js";

describe("editionCadence", () => {
  it("maps Monday, Wednesday and Friday to daily editions", () => {
    expect(resolveEditionType("2026-06-22")).toBe("daily"); // Monday
    expect(resolveEditionType("2026-06-24")).toBe("daily"); // Wednesday
    expect(resolveEditionType("2026-06-26")).toBe("daily"); // Friday
  });

  it("maps Sunday to the weekly digest edition", () => {
    expect(resolveEditionType("2026-06-21")).toBe("weekly_digest"); // Sunday
  });

  it("returns null on quiet days (Tue/Thu/Sat)", () => {
    expect(resolveEditionType("2026-06-23")).toBeNull(); // Tuesday
    expect(resolveEditionType("2026-06-25")).toBeNull(); // Thursday
    expect(resolveEditionType("2026-06-20")).toBeNull(); // Saturday
    expect(isEditionDay("2026-06-20")).toBe(false);
  });

  it("does not drift across timezones (anchored to UTC noon)", () => {
    expect(resolveEditionType("2026-06-21")).toBe("weekly_digest");
    expect(resolveEditionType("invalid-date")).toBeNull();
  });

  it("parses forced edition overrides for dry-runs and tests", () => {
    expect(parseForcedEditionType("daily")).toBe("daily");
    expect(parseForcedEditionType("weekly_digest")).toBe("weekly_digest");
    expect(parseForcedEditionType("weekly")).toBe("weekly_digest");
    expect(parseForcedEditionType("true")).toBe("daily");
    expect(parseForcedEditionType(undefined)).toBeNull();
    expect(parseForcedEditionType("nope")).toBeNull();
  });

  it("finds the next scheduled edition after a quiet day", () => {
    expect(nextEditionDate("2026-06-23")).toEqual({
      date: "2026-06-24",
      editionType: "daily"
    }); // Tue -> Wed
    expect(nextEditionDate("2026-06-26")).toEqual({
      date: "2026-06-28",
      editionType: "weekly_digest"
    }); // Fri -> Sun
  });
});

/**
 * The editorial date is resolved in one timezone for the whole product. These
 * are the instants where a UTC-based date (what this used to be) and the
 * Europe/Paris date disagree — the nightly window in which the app asked for an
 * edition the job had not built yet.
 */
describe("getProductEditionDate", () => {
  it("uses the single product timezone", () => {
    expect(PRODUCT_TIME_ZONE).toBe("Europe/Paris");
  });

  it("is already tomorrow in Paris while UTC is still the previous day (summer)", () => {
    // 00:30 Paris on 22 June (CEST, UTC+2) — UTC still says 21 June.
    const instant = new Date("2026-06-21T22:30:00Z");

    expect(instant.toISOString().slice(0, 10)).toBe("2026-06-21");
    expect(getProductEditionDate(instant)).toBe("2026-06-22");
  });

  it("is already tomorrow in Paris while UTC is still the previous day (winter)", () => {
    // 00:30 Paris on 15 January (CET, UTC+1) — UTC still says 14 January.
    const instant = new Date("2026-01-14T23:30:00Z");

    expect(instant.toISOString().slice(0, 10)).toBe("2026-01-14");
    expect(getProductEditionDate(instant)).toBe("2026-01-15");
  });

  it("stays on the current date just before the Paris midnight boundary", () => {
    // 23:30 Paris on 21 June, and 01:00 Paris on 15 January.
    expect(getProductEditionDate(new Date("2026-06-21T21:30:00Z"))).toBe("2026-06-21");
    expect(getProductEditionDate(new Date("2026-01-15T00:00:00Z"))).toBe("2026-01-15");
  });

  it("handles the DST transitions themselves", () => {
    // Spring forward: 02:00 -> 03:00 Paris on 29 March 2026.
    expect(getProductEditionDate(new Date("2026-03-29T00:30:00Z"))).toBe("2026-03-29");
    expect(getProductEditionDate(new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-29");
    // Fall back: 03:00 -> 02:00 Paris on 25 October 2026.
    expect(getProductEditionDate(new Date("2026-10-25T00:30:00Z"))).toBe("2026-10-25");
    expect(getProductEditionDate(new Date("2026-10-24T22:30:00Z"))).toBe("2026-10-25");
  });

  it("never disagrees with UTC by more than the Paris offset", () => {
    // Midday UTC is unambiguous all year: the two agree outside the night window.
    expect(getProductEditionDate(new Date("2026-06-21T12:00:00Z"))).toBe("2026-06-21");
    expect(getProductEditionDate(new Date("2026-01-14T12:00:00Z"))).toBe("2026-01-14");
  });

  it("produces a drop_date-shaped string", () => {
    expect(getProductEditionDate(new Date("2026-08-17T09:00:00Z"))).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
  });

  it("keeps the weekday cadence consistent with the resolved date", () => {
    // 00:30 Paris on Monday 22 June: an edition day, even though UTC still
    // reads Sunday 21 June (a weekly digest day).
    const instant = new Date("2026-06-21T22:30:00Z");

    expect(resolveEditionType(getProductEditionDate(instant))).toBe("daily");
    expect(resolveEditionType(instant.toISOString().slice(0, 10))).toBe("weekly_digest");
  });
});
