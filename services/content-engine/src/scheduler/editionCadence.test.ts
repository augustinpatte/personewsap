import { describe, expect, it } from "vitest";

import {
  isEditionDay,
  nextEditionDate,
  parseForcedEditionType,
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
