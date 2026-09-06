import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The publisher carries the questions without carrying the answer key.
 *
 * Static checks, for the same reason the Teams migrations have them: this SQL
 * cannot be executed here, and the specific failure it guards against is silent.
 * `publish_scheduled_staging_payload` builds `content_items.metadata`
 * SUBTRACTIVELY —
 *
 *     (v_item - 'body_md' - 'title' - ...)
 *
 * — so any field the generator emits that is not explicitly removed lands in a
 * column every authenticated reader can SELECT. Adding a `questions` block with
 * `score_milli` in it therefore publishes the answer key by default, and nothing
 * would fail: the edition would go out, look correct, and every scored question
 * in the product would be trivially winnable.
 */

const migration = readFileSync(
  join(__dirname, "..", "migrations", "20260906100000_publish_scored_questions.sql"),
  "utf8"
);

const code = migration.replace(/^\s*--.*$/gm, "");

describe("the metadata leak", () => {
  it("strips the question block out of the published metadata", () => {
    expect(code).toContain("- \\'questions\\'");
  });

  it("refuses to patch the publisher blind", () => {
    // The migration rewrites a function recovered from production. If the
    // metadata expression is not the one it expects, it must fail loudly rather
    // than produce a publisher that half works.
    expect(code).toContain("refusing to patch blind");
    expect(code).toContain("apply 20260826174155 first");
  });

  it("is re-runnable", () => {
    expect(code).toContain("already carries questions; nothing to do");
  });

  it("keeps a standing guard against the next field that leaks grading", () => {
    expect(code).toContain("assert_metadata_carries_no_answer_key");

    for (const leak of ["score_milli", "is_correct", "grade_band", "decision_criterion"]) {
      expect(code, leak).toContain(leak);
    }
  });
});

describe("where the grading goes", () => {
  it("writes the answer key into the private schema and nowhere else", () => {
    expect(code).toContain("private.logical_question_grades");
    expect(code).toContain("private.logical_question_option_feedback");

    // The display side stays public; the grading side never does.
    const publicInserts = code.match(/INSERT INTO public\.\w+/g) ?? [];
    expect(publicInserts.join(" ")).not.toMatch(/grade/i);
  });

  it("accepts only the four tiers", () => {
    expect(code).toContain("NOT IN (0, 300, 600, 1000)");
    expect(code).toMatch(/WHEN 0 THEN 'bad'/);
    expect(code).toMatch(/WHEN 1000 THEN 'excellent'/);
  });

  it("refuses a scale that differs between languages", () => {
    // Two team-mates reading in different languages must be scored identically.
    expect(code).toContain("scores % in en and % in fr");
  });

  it("matches options by id rather than by position", () => {
    // Positional matching would attach the French "bad" text to the English
    // "excellent" grade the first time a generator listed them in a different
    // order, and nothing would look wrong.
    expect(code).toContain("value->>'id' = v_en_option->>'id'");
  });
});

describe("question counts survive the publisher", () => {
  it("requires three for a mini case and two for the rest", () => {
    expect(code).toContain("CASE p_content_type WHEN 'mini_case' THEN 3 ELSE 2 END");
    expect(code).toContain("needs exactly % questions in both languages");
  });

  it("requires four options in both languages", () => {
    expect(code).toContain("must have exactly 4 options in both languages");
  });
});

describe("idempotence and blast radius", () => {
  it("never re-grades a question that already exists", () => {
    // A reader may already have answered it, so re-grading on a republish would
    // change what an answered question was worth. The guard is the lookup on
    // (content_logical_key, content_type, question_sequence) followed by an
    // unconditional skip — asserted as code, not as the comment above it.
    const lookup = code.indexOf("FROM public.logical_questions q");

    expect(lookup).toBeGreaterThan(-1);

    const guard = code.slice(lookup, lookup + 400);

    expect(guard).toContain("q.content_logical_key = p_content_logical_key");
    expect(guard).toContain("q.question_sequence = v_index + 1");
    expect(guard).toMatch(/IF FOUND THEN[\s\S]{0,200}CONTINUE;/);
  });

  it("keeps a bad question block from rolling back a valid edition", () => {
    expect(code).toContain("publish_scheduled_batch_questions");
    expect(code).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(code).toContain("question_persist_failed");
  });

  it("treats content with no questions as valid, not as a failure", () => {
    // Two months of approved Premium predates questions entirely, and those
    // editions must still publish.
    expect(code).toContain("RETURN 0;");
  });
});

describe("privileges", () => {
  it("keeps every new function away from client roles", () => {
    for (const fn of [
      "public.persist_content_questions",
      "public.publish_scheduled_batch_questions"
    ]) {
      const escaped = fn.replace(".", "\\.");

      expect(
        new RegExp(`REVOKE ALL ON FUNCTION ${escaped}\\([^)]*\\) FROM PUBLIC`, "i").test(code),
        `${fn} must be revoked from PUBLIC`
      ).toBe(true);
      expect(
        new RegExp(`REVOKE ALL ON FUNCTION ${escaped}\\([^)]*\\) FROM authenticated`, "i").test(code),
        `${fn} must be revoked from authenticated`
      ).toBe(true);
    }
  });

  it("grants nothing to anon", () => {
    expect(code).not.toMatch(/GRANT[^;]*\banon\b/i);
  });

  it("pins the search_path on every SECURITY DEFINER function", () => {
    const definers = code.split("CREATE OR REPLACE FUNCTION").filter((block) =>
      /SECURITY DEFINER/i.test(block)
    );

    expect(definers.length).toBeGreaterThan(0);

    for (const block of definers) {
      expect(block).toMatch(/SET search_path = public, pg_temp/i);
    }
  });
});

describe("what it does not touch", () => {
  it("changes no editorial content", () => {
    // The whole point: questions are added, writing is not altered.
    expect(code).not.toMatch(/UPDATE public\.content_items/i);
    expect(code).not.toMatch(/DELETE FROM public\.content_items/i);
  });

  it("leaves the composition and review gates alone", () => {
    // The migration replaces the publisher by rewriting its own recorded source,
    // so it must not be restating any of the rules it inherits.
    expect(code).not.toContain("expected 23 jobs");
    expect(code).not.toContain("review is below bar");
    expect(code).not.toContain("newsletter topic composition");
  });

  it("touches no notification, push or learning table", () => {
    for (const forbidden of [
      "push_tokens",
      "push_notification_deliveries",
      "learning_sessions",
      "daily_drops",
      "daily_drop_items"
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});
