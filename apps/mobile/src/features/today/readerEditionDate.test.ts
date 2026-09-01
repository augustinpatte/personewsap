import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getUserLocalDateKey } from "../../lib/localDate";
import {
  getProductEditionDate,
  isEditionDay,
  resolveReaderEditionDate
} from "./editionCadence";
import { resolveTodayEditionState } from "./todayEditionState";

/**
 * Which edition the Today view asks Supabase for.
 *
 * The reported bug: at 2026-08-30 21:30 in New Orleans the app already asked
 * for the 31st, because the edition date was the Paris one. Sunday's edition —
 * still that reader's edition of the day — vanished from Today and was only
 * reachable through the archive, 2.5 hours before their local midnight.
 */

/** 2026-08-30 21:30 America/Chicago = 2026-08-31 04:30 Europe/Paris. */
const NEW_ORLEANS_SUNDAY_EVENING = new Date("2026-08-31T02:30:00Z");

describe("the New Orleans scenario", () => {
  it("asks for Sunday's edition while the reader is still on Sunday", () => {
    expect(getUserLocalDateKey(NEW_ORLEANS_SUNDAY_EVENING, "America/Chicago")).toBe(
      "2026-08-30"
    );
    // Paris — and the old behaviour — had already moved on.
    expect(getProductEditionDate(NEW_ORLEANS_SUNDAY_EVENING)).toBe("2026-08-31");

    expect(
      resolveReaderEditionDate(NEW_ORLEANS_SUNDAY_EVENING, "America/Chicago")
    ).toBe("2026-08-30");
  });

  it("renders that edition instead of an empty state", () => {
    const dropDate = resolveReaderEditionDate(
      NEW_ORLEANS_SUNDAY_EVENING,
      "America/Chicago"
    );

    expect(
      resolveTodayEditionState({
        dropDate,
        error: null,
        isEmptyDrop: false,
        status: "ready"
      })
    ).toBe("edition");
  });

  it("moves it to the past only at the reader's own midnight", () => {
    // 2026-08-30 23:59 America/Chicago.
    expect(
      resolveReaderEditionDate(new Date("2026-08-31T04:59:00Z"), "America/Chicago")
    ).toBe("2026-08-30");
    // 2026-08-31 00:01 America/Chicago.
    expect(
      resolveReaderEditionDate(new Date("2026-08-31T05:01:00Z"), "America/Chicago")
    ).toBe("2026-08-31");
  });
});

describe("readers west of the publisher get their own day", () => {
  it.each([
    ["America/Chicago", "2026-08-30"],
    ["America/Los_Angeles", "2026-08-30"],
    ["America/New_York", "2026-08-30"]
  ])("%s stays on %s at the same instant", (zone, expected) => {
    expect(resolveReaderEditionDate(NEW_ORLEANS_SUNDAY_EVENING, zone)).toBe(expected);
  });

  it("never advances a US reader because UTC rolled over", () => {
    // 2026-08-31 00:30 UTC: still the 30th everywhere in the US.
    const utcRollover = new Date("2026-08-31T00:30:00Z");

    expect(utcRollover.toISOString().slice(0, 10)).toBe("2026-08-31");

    for (const zone of ["America/Chicago", "America/Los_Angeles", "America/New_York"]) {
      expect(resolveReaderEditionDate(utcRollover, zone)).toBe("2026-08-30");
    }
  });
});

describe("readers east of the publisher are capped at what exists", () => {
  /**
   * The job builds the edition for editorial day D at 19:00 Europe/Paris on D,
   * which is already 02:00 on D+1 in Tokyo. A reader whose local day ran ahead
   * of the publisher's would ask for an edition that has never been written and
   * would see an empty app — so the reader's day is capped at the publisher's.
   */
  it("gives Tokyo the edition that exists, not their own later date", () => {
    // 2026-08-30 20:00 Europe/Paris = 2026-08-31 03:00 Asia/Tokyo.
    const justAfterPublication = new Date("2026-08-30T18:00:00Z");

    expect(getUserLocalDateKey(justAfterPublication, "Asia/Tokyo")).toBe("2026-08-31");
    expect(getProductEditionDate(justAfterPublication)).toBe("2026-08-30");

    expect(resolveReaderEditionDate(justAfterPublication, "Asia/Tokyo")).toBe(
      "2026-08-30"
    );
  });

  it("never asks for an edition date the publisher has not reached", () => {
    const zones = ["Asia/Tokyo", "Australia/Sydney", "Pacific/Kiritimati", "Asia/Kolkata"];

    for (let hour = 0; hour < 24; hour += 1) {
      const instant = new Date(Date.UTC(2026, 7, 30, hour, 30));

      for (const zone of zones) {
        expect(
          resolveReaderEditionDate(instant, zone) <= getProductEditionDate(instant)
        ).toBe(true);
      }
    }
  });
});

describe("the resolved date is always a usable calendar day", () => {
  it("is drop_date-shaped and never ahead of the reader's own day", () => {
    const zones = [
      "America/Chicago",
      "America/Los_Angeles",
      "Europe/Paris",
      "Asia/Tokyo",
      "Pacific/Midway",
      "UTC"
    ];

    for (let hour = 0; hour < 24; hour += 1) {
      const instant = new Date(Date.UTC(2026, 7, 30, hour, 30));

      for (const zone of zones) {
        const resolved = resolveReaderEditionDate(instant, zone);

        expect(resolved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // Never an edition dated in the reader's future.
        expect(resolved <= getUserLocalDateKey(instant, zone)).toBe(true);
      }
    }
  });

  it("keeps the weekday cadence readable from the resolved date", () => {
    // 2026-08-30 is a Sunday: the weekly digest.
    expect(isEditionDay(resolveReaderEditionDate(NEW_ORLEANS_SUNDAY_EVENING, "America/Chicago"))).toBe(
      true
    );
  });
});

describe("no reader's day is ever derived from a hardcoded geography", () => {
  it("keeps Europe/Paris and the UTC slice out of the reader-side date path", () => {
    const source = readFileSync(
      join(__dirname, "..", "..", "lib", "localDate.ts"),
      "utf8"
    );
    // Both are named in the prose there, deliberately, as what this must not
    // do. Only the executable lines are asserted on.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).not.toMatch(/Europe\/Paris/);
    expect(code).not.toMatch(/toISOString/);
    expect(code).toMatch(/Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  });

  it("resolves the Today view's date through the reader helper", () => {
    const provider = readFileSync(join(__dirname, "DailyDropContext.tsx"), "utf8");

    expect(provider).toMatch(/resolveReaderEditionDate\(\)/);
    expect(provider).not.toMatch(/getProductEditionDate\(\)/);
    expect(provider).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });
});
