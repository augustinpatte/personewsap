import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseDailyJobOptions, parseDailyJobTestOptions } from "./dailyJobTest.js";
import { parseDryRunOptions } from "./dryRun.js";
import { parseJobHealthOptions } from "./jobHealth.js";
import { parseRssCheckOptions } from "./rssCheck.js";

/**
 * Which date a job works on when the operator does not say.
 *
 * The default is the editorial date in the product timezone, not the UTC one:
 * a job started at 00:30 Paris must build the edition the app is already asking
 * for. An explicit --date is an instruction and is passed through exactly.
 */

// 00:30 Paris on Monday 22 June 2026 (CEST); UTC still reads Sunday 21 June.
const PARIS_PAST_MIDNIGHT = new Date("2026-06-21T22:30:00Z");
// 00:30 Paris on Thursday 15 January 2026 (CET); UTC still reads 14 January.
const PARIS_PAST_MIDNIGHT_WINTER = new Date("2026-01-14T23:30:00Z");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("default edition date", () => {
  it.each([
    ["summer", PARIS_PAST_MIDNIGHT, "2026-06-22", "2026-06-21"],
    ["winter", PARIS_PAST_MIDNIGHT_WINTER, "2026-01-15", "2026-01-14"]
  ])(
    "the production daily job builds the Paris date, not the UTC one (%s)",
    (_season, instant, parisDate, utcDate) => {
      vi.setSystemTime(instant);

      expect(parseDailyJobOptions([]).dropDate).toBe(parisDate);
      expect(parseDailyJobTestOptions([]).dropDate).toBe(parisDate);
      // The very disagreement this fixes.
      expect(parisDate).not.toBe(utcDate);
    }
  );

  it("applies to every CLI that resolves an edition date on its own", () => {
    vi.setSystemTime(PARIS_PAST_MIDNIGHT);

    expect(parseDryRunOptions([]).dropDate).toBe("2026-06-22");
    expect(parseJobHealthOptions([]).runDate).toBe("2026-06-22");
    expect(parseRssCheckOptions([]).since).toBe("2026-06-22");
  });

  it("agrees with UTC outside the nightly window", () => {
    vi.setSystemTime(new Date("2026-06-22T12:00:00Z"));

    expect(parseDailyJobOptions([]).dropDate).toBe("2026-06-22");
  });
});

describe("explicit --date", () => {
  it("is used exactly as given, whatever the clock says", () => {
    vi.setSystemTime(PARIS_PAST_MIDNIGHT);

    for (const options of [
      parseDailyJobOptions(["--date", "2026-06-19"]),
      parseDailyJobTestOptions(["--date", "2026-06-19"]),
      parseDryRunOptions(["--date", "2026-06-19"])
    ]) {
      expect(options.dropDate).toBe("2026-06-19");
    }

    expect(parseJobHealthOptions(["--date", "2026-06-19"]).runDate).toBe("2026-06-19");
    expect(parseRssCheckOptions(["--date", "2026-06-19"]).since).toBe("2026-06-19");
    expect(parseRssCheckOptions(["--since", "2026-06-01"]).since).toBe("2026-06-01");
  });

  it("is not rewritten into the product timezone", () => {
    vi.setSystemTime(PARIS_PAST_MIDNIGHT_WINTER);

    // A backfill for a past edition must stay on that exact date.
    expect(parseDailyJobOptions(["--date", "2026-01-05"]).dropDate).toBe("2026-01-05");
  });
});
