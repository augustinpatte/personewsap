import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseDailyJobOptions } from "./dailyJobTest.js";

/**
 * Editions seeded before launch are shown without a calendar date. The marker is
 * explicit and per edition, and it only ever gets set because somebody asked for
 * it on the command line.
 *
 * The rule worth defending here is the negative one: an automated production run
 * must never produce an undated edition by accident.
 */

const cliRoot = __dirname;
const engineRoot = join(cliRoot, "..");

describe("marking an edition as prelaunch", () => {
  it("is off unless asked for", () => {
    expect(parseDailyJobOptions([]).prelaunch).toBe(false);
    expect(parseDailyJobOptions(["--date=2026-08-19", "--llm"]).prelaunch).toBe(false);
  });

  it("is set by --prelaunch", () => {
    expect(parseDailyJobOptions(["--prelaunch"]).prelaunch).toBe(true);
  });

  it("is also set by the more literal --hide-display-date", () => {
    expect(parseDailyJobOptions(["--hide-display-date"]).prelaunch).toBe(true);
  });

  it("does not read a launch date, the clock or the edition's own date", () => {
    // A date before any plausible launch is still a normal dated edition: the
    // flag is never inferred.
    expect(parseDailyJobOptions(["--date=2020-01-01"]).prelaunch).toBe(false);
  });
});

describe("the automated production path never hides a date", () => {
  it("passes the flag explicitly as false", () => {
    const scheduler = readFileSync(join(engineRoot, "scheduler", "dailyJob.ts"), "utf8");

    expect(scheduler).toMatch(/prelaunch: false/);
  });

  it("keeps the daily-job test path dated too", () => {
    const job = readFileSync(join(cliRoot, "dailyJobTest.ts"), "utf8");
    const testRun = job.slice(job.indexOf("export async function runDailyJobTest"));

    expect(testRun.slice(0, testRun.indexOf("\n}"))).toMatch(/prelaunch: false/);
  });

  it("writes the column from the option rather than defaulting it in SQL alone", () => {
    const repository = readFileSync(join(engineRoot, "storage", "contentRepository.ts"), "utf8");

    expect(repository).toMatch(/hide_display_date: input\.hideDisplayDate === true/);
  });
});

describe("the flag belongs to the edition, not to its content", () => {
  it("is stored on daily_drops and on nothing else", () => {
    const migration = readFileSync(
      join(engineRoot, "..", "..", "..", "supabase", "migrations", "20260820090000_daily_drops_hide_display_date.sql"),
      "utf8"
    );

    expect(migration).toMatch(/ALTER TABLE public\.daily_drops/);
    expect(migration).toMatch(/hide_display_date BOOLEAN NOT NULL DEFAULT false/);
    // A reusable Business Story or Mini Case must stay independent of one
    // edition's display choice.
    expect(migration).not.toMatch(/ALTER TABLE public\.content_items/);
  });
});

describe("factual and source dates are untouched", () => {
  it("leaves the canonical source footer alone", () => {
    const sanitizer = readFileSync(join(engineRoot, "generation", "llmSanitizer.ts"), "utf8");

    // The footer still cites the source's own publication and retrieval dates.
    expect(sanitizer).toMatch(/published \$\{publishedDate\}, retrieved \$\{retrievedDate\}/);
    expect(sanitizer).not.toMatch(/hide_display_date/);
  });

  it("does not reach into content generation or validation at all", () => {
    for (const file of ["llmGenerator.ts", "validation.ts", "prompts.ts"]) {
      const source = readFileSync(join(engineRoot, "generation", file), "utf8");

      expect(source).not.toMatch(/hide_display_date|hideDisplayDate/);
    }
  });
});
