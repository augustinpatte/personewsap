import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getModuleCopy } from "../modules/moduleCopy";
import type { NormalizedSupabaseError } from "../../lib/supabase";
import { getProductEditionDate, isEditionDay } from "./editionCadence";
import {
  isQuietEditionState,
  nextEditionWeekday,
  resolveTodayEditionState,
  type TodayEditionStateInput
} from "./todayEditionState";

/**
 * The Today state matrix, pinned.
 *
 * The rule worth defending is that "scheduled edition day?" and "did an edition
 * arrive?" are two independent facts, and that neither of them may be inferred
 * from a failed or unfinished query. Getting that wrong produces the two
 * failures this file exists to catch: telling a reader there is no edition when
 * Supabase simply errored, and telling them one is coming on a day the product
 * never publishes.
 */

// A Wednesday and a Sunday publish; Tuesday and Saturday are off-days.
const SCHEDULED_DAILY = "2026-08-19"; // Wednesday
const SCHEDULED_DIGEST = "2026-08-23"; // Sunday
const OFF_DAY = "2026-08-18"; // Tuesday
const OFF_DAY_SATURDAY = "2026-08-22";

const anError: NormalizedSupabaseError = {
  code: "PGRST301",
  message: "Network request failed"
} as NormalizedSupabaseError;

function input(overrides: Partial<TodayEditionStateInput> = {}): TodayEditionStateInput {
  return {
    dropDate: SCHEDULED_DAILY,
    error: null,
    isEmptyDrop: false,
    status: "ready",
    ...overrides
  };
}

describe("the fixtures match the canonical cadence", () => {
  it("uses real scheduled and off days", () => {
    expect(isEditionDay(SCHEDULED_DAILY)).toBe(true);
    expect(isEditionDay(SCHEDULED_DIGEST)).toBe(true);
    expect(isEditionDay(OFF_DAY)).toBe(false);
    expect(isEditionDay(OFF_DAY_SATURDAY)).toBe(false);
  });
});

describe("an edition that exists is always rendered", () => {
  it("renders on a scheduled day", () => {
    expect(resolveTodayEditionState(input({ dropDate: SCHEDULED_DAILY }))).toBe("edition");
  });

  it("renders on an off-day too: content wins over the schedule", () => {
    // A drop published on a quiet day is a stronger fact than the weekday map.
    // Hiding it because "today is normally quiet" would lose real content.
    expect(resolveTodayEditionState(input({ dropDate: OFF_DAY }))).toBe("edition");
  });

  it("renders cached content even while an error is still attached", () => {
    expect(resolveTodayEditionState(input({ error: anError }))).toBe("edition");
  });
});

describe("no edition, query succeeded", () => {
  it("a scheduled day shows the upcoming state", () => {
    expect(
      resolveTodayEditionState(input({ dropDate: SCHEDULED_DAILY, isEmptyDrop: true }))
    ).toBe("upcoming");
  });

  it("the weekly digest day is a scheduled day too", () => {
    expect(
      resolveTodayEditionState(input({ dropDate: SCHEDULED_DIGEST, isEmptyDrop: true }))
    ).toBe("upcoming");
  });

  it("an off-day shows the intentional no-edition state", () => {
    expect(resolveTodayEditionState(input({ dropDate: OFF_DAY, isEmptyDrop: true }))).toBe(
      "quiet"
    );
    expect(
      resolveTodayEditionState(input({ dropDate: OFF_DAY_SATURDAY, isEmptyDrop: true }))
    ).toBe("quiet");
  });

  it("treats an unparseable date as an off-day rather than promising an edition", () => {
    expect(resolveTodayEditionState(input({ dropDate: "not-a-date", isEmptyDrop: true }))).toBe(
      "quiet"
    );
  });
});

describe("loading and error are never mistaken for an empty schedule", () => {
  it("an unresolved load shows neither quiet state", () => {
    for (const dropDate of [SCHEDULED_DAILY, OFF_DAY]) {
      const state = resolveTodayEditionState(
        input({ dropDate, isEmptyDrop: true, status: "loading" })
      );

      expect(state).toBe("loading");
      expect(isQuietEditionState(state)).toBe(false);
    }
  });

  it("a failed query keeps the existing error treatment", () => {
    expect(
      resolveTodayEditionState(input({ error: anError, isEmptyDrop: true }))
    ).toBe("error");
  });

  it("never claims there is no edition when the query failed — on either kind of day", () => {
    for (const dropDate of [SCHEDULED_DAILY, SCHEDULED_DIGEST, OFF_DAY, OFF_DAY_SATURDAY]) {
      const state = resolveTodayEditionState(
        input({ dropDate, error: anError, isEmptyDrop: true })
      );

      expect(state).toBe("error");
      expect(isQuietEditionState(state)).toBe(false);
    }
  });
});

describe("the edition date is the product's, not the device's", () => {
  it("resolves the same calendar day for every device timezone", () => {
    // 22:30 UTC on the 18th is already 00:30 on the 19th in Paris. A reader in
    // New York (18:30, still the 18th locally) must be told about the same
    // edition as a reader in Paris, or the app asks for a drop the job never
    // built.
    const lateEvening = new Date("2026-08-18T22:30:00Z");

    expect(getProductEditionDate(lateEvening)).toBe("2026-08-19");
    expect(isEditionDay(getProductEditionDate(lateEvening))).toBe(true);
  });

  it("does not roll over at UTC midnight", () => {
    // 00:30 UTC on the 19th is 02:30 in Paris: same editorial day, not the next.
    expect(getProductEditionDate(new Date("2026-08-19T00:30:00Z"))).toBe("2026-08-19");
    // And the naive UTC slice everyone reaches for disagrees an hour earlier.
    const beforeUtcMidnight = new Date("2026-08-18T23:30:00Z");
    expect(beforeUtcMidnight.toISOString().slice(0, 10)).toBe("2026-08-18");
    expect(getProductEditionDate(beforeUtcMidnight)).toBe("2026-08-19");
  });

  it("agrees with the content engine's own helper", () => {
    const mobile = readFileSync(join(__dirname, "editionCadence.ts"), "utf8");
    const engine = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "..",
        "services",
        "content-engine",
        "src",
        "scheduler",
        "editionCadence.ts"
      ),
      "utf8"
    );

    for (const source of [mobile, engine]) {
      expect(source).toMatch(/PRODUCT_TIME_ZONE = "Europe\/Paris"/);
      // Same weekday map on both sides, or the app frames a publishing day as
      // quiet.
      expect(source).toMatch(/1: "daily"/);
      expect(source).toMatch(/3: "daily"/);
      expect(source).toMatch(/5: "daily"/);
      expect(source).toMatch(/0: "weekly_digest"/);
    }
  });
});

describe("the next-edition hint comes from the canonical schedule", () => {
  it("names the next publishing weekday after an off-day", () => {
    expect(nextEditionWeekday(OFF_DAY, "en")).toBe("Wednesday");
    expect(nextEditionWeekday(OFF_DAY, "fr")).toBe("mercredi");
    // Saturday -> Sunday's weekly digest.
    expect(nextEditionWeekday(OFF_DAY_SATURDAY, "en")).toBe("Sunday");
  });

  it("formats the weekday in UTC, so it cannot shift for a far-east reader", () => {
    // Formatting the UTC-noon anchor in a UTC+13 device timezone would land on
    // the following day and print the wrong weekday.
    expect(nextEditionWeekday(OFF_DAY, "en")).toBe("Wednesday");
    expect(
      new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long" }).format(
        new Date("2026-08-19T12:00:00Z")
      )
    ).toBe("Wednesday");
  });

  it("returns null on a date it cannot read, so the line is simply dropped", () => {
    expect(nextEditionWeekday("2026-13-45", "fr")).toBeNull();
    expect(nextEditionWeekday("", "en")).toBeNull();
  });
});

describe("both states are written in the reader's language", () => {
  const fr = getModuleCopy("fr").common;
  const en = getModuleCopy("en").common;

  it("FR carries French copy for the upcoming state", () => {
    expect(fr.onItsWayTitle).toBe("L'édition du jour arrive");
    expect(fr.onItsWayBody).toMatch(/en préparation/);
    expect(fr.onItsWaySecondary).toMatch(/archives/);
    expect(fr.browseArchive).toBe("Voir les archives");
  });

  it("FR carries French copy for the off-day state", () => {
    expect(fr.quietDayTitle).toBe("Pas de nouvelle édition aujourd'hui");
    expect(fr.quietDayBody).toMatch(/certains jours/);
    expect(fr.quietDaySecondary).toMatch(/archives/);
    expect(fr.exploreArchive).toBe("Explorer les archives");
    expect(fr.nextEdition("mercredi")).toBe("Prochaine édition : mercredi.");
  });

  it("EN carries English copy for both states", () => {
    expect(en.onItsWayTitle).toBe("Today's edition is on the way");
    expect(en.quietDayTitle).toBe("No new edition today");
    expect(en.browseArchive).toBe("Browse the archive");
    expect(en.exploreArchive).toBe("Explore the archive");
    expect(en.nextEdition("Wednesday")).toBe("Next edition: Wednesday.");
  });

  it("switching FR -> EN and EN -> FR swaps every string of both states", () => {
    // The screens read this on each render from the profile language, so a
    // change applies immediately. Nothing here may be shared between the two.
    const keys = [
      "onItsWayTitle",
      "onItsWayBody",
      "onItsWaySecondary",
      "browseArchive",
      "quietDayTitle",
      "quietDayBody",
      "quietDaySecondary",
      "exploreArchive"
    ] as const;

    for (const key of keys) {
      expect(fr[key]).not.toBe(en[key]);
      expect(fr[key].length).toBeGreaterThan(3);
      expect(en[key].length).toBeGreaterThan(3);
    }

    expect(getModuleCopy("fr").common.quietDayTitle).toBe(fr.quietDayTitle);
    expect(getModuleCopy("en").common.quietDayTitle).toBe(en.quietDayTitle);
  });

  it("says nothing about jobs, backends, delays or AI", () => {
    const surfaces = [fr, en].flatMap((copy) => [
      copy.onItsWayTitle,
      copy.onItsWayBody,
      copy.onItsWaySecondary,
      copy.quietDayTitle,
      copy.quietDayBody,
      copy.quietDaySecondary
    ]);

    for (const line of surfaces) {
      expect(line).not.toMatch(/\b(cron|backend|serveur|server|job|AI|IA|API|génér|generat)/i);
      // Not an apology, and not an error.
      expect(line).not.toMatch(/(sorry|désolé|erreur|error|échec|failed)/i);
    }
  });
});

describe("both states offer the archive as their action", () => {
  const quietState = readFileSync(
    join(__dirname, "..", "modules", "TodayQuietState.tsx"),
    "utf8"
  );

  it("puts an archive CTA on the upcoming state and on the off-day state", () => {
    expect(quietState).toMatch(/copy\.browseArchive/);
    expect(quietState).toMatch(/copy\.exploreArchive/);
    expect(quietState).toMatch(/<PrimaryButton[\s\S]{0,160}onPress=\{onOpenArchive\}/);
  });

  it("keeps a refresh only where refreshing can change something", () => {
    // An off-day has nothing to pick up; a scheduled day may still receive its
    // edition while the app is open.
    expect(quietState).toMatch(/upcoming \? <SecondaryButton label=\{copy\.retry\}/);
  });

  it("never derives its own state, so it cannot disagree with the screen", () => {
    expect(quietState).not.toMatch(/isEditionDay/);
    expect(quietState).toMatch(/state: "upcoming" \| "quiet"/);
  });

  it("shows no error tone: no warning icon, no danger colour", () => {
    expect(quietState).toMatch(/tone="muted"/);
    expect(quietState).not.toMatch(/tone="danger"/);
    expect(quietState).not.toMatch(/alert-triangle|alert-circle/);
  });
});

describe("every content module routes through the one resolver", () => {
  const modulesDir = join(__dirname, "..", "modules");
  const screens = [
    ["newsletter", "NewsletterModuleScreen.tsx"],
    ["mini cases", "MiniCasesModuleScreen.tsx"],
    ["stories", "StoriesModuleScreen.tsx"]
  ] as const;

  it.each(screens)("%s asks resolveTodayEditionState, not its own if-chain", (_name, file) => {
    const source = readFileSync(join(modulesDir, file), "utf8");

    expect(source).toMatch(/resolveTodayEditionState\(\{/);
    expect(source).toMatch(/editionState === "loading"/);
    expect(source).toMatch(/editionState === "error"/);
    expect(source).toMatch(/editionState === "upcoming" \|\| editionState === "quiet"/);
    // The old shape: an empty drop decided the empty state on its own.
    expect(source).not.toMatch(/isEmptyDrop && error/);
  });

  it.each(screens)("%s wires the CTA to its existing Archive view", (_name, file) => {
    const source = readFileSync(join(modulesDir, file), "utf8");

    // The archive already exists behind the module's Today | Archive switch.
    // The CTA flips that switch; it does not introduce a new screen or route.
    expect(source).toMatch(/onOpenArchive=\{\(\) => setView\("right"\)\}/);
    expect(source).toMatch(/onOpenArchive=\{onOpenArchive\}/);
    expect(source).toMatch(/state=\{editionState\}/);
  });

  it("asks Supabase for the product edition date, never a device-local one", () => {
    const provider = readFileSync(join(__dirname, "DailyDropContext.tsx"), "utf8");

    expect(provider).toMatch(/getProductEditionDate\(\)/);
    expect(provider).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });
});
