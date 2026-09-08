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

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, "..", "..", ...parts), "utf8");
}

/** SQL with full-line comments removed, so prose is never a finding. */
function stripComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, "");
}

const migration = read("supabase", "migrations", "20260906100000_publish_scored_questions.sql");
// The CURRENT definition. 20260906105000 introduced this function and
// 20260907190000 replaced it wholesale, so reading the older file would be
// asserting against a body no database runs.
const verification = read("supabase", "migrations", "20260907190000_verify_edition_game_contract.sql");
const declaration = read(
  "supabase",
  "migrations",
  "20260907180000_scored_question_contract_declaration.sql"
);
const preflight = read(
  "supabase-staging",
  "supabase",
  "migrations",
  "20260906110000_scored_question_preflight.sql"
);
const publisherCore = read("supabase", "functions", "personews-task-publisher", "core.ts");
const publisherEntry = read("supabase", "functions", "personews-task-publisher", "index.ts");
const bridge = read("supabase", "functions", "personews-task-bridge", "index.ts");

const code = stripComments(migration);
const verificationCode = stripComments(verification);
const declarationCode = stripComments(declaration);
/**
 * Comments AND string literals removed.
 *
 * `stripComments` only takes out `--` lines, and the assertion below is about
 * what the SQL DOES, not about what its COMMENT ON says it avoids doing — the
 * function comment names `logical_questions` precisely to record that it must
 * never read it.
 */
const declarationSql = declarationCode.replace(/'(?:[^']|'')*'/g, "''");
const preflightCode = stripComments(preflight);

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

describe("the staging preflight knows about questions", () => {
  it("requires the right count and roles per surface", () => {
    // The three surfaces, and the mini case progression that IS the exercise.
    expect(preflightCode).toContain("array['interpretation', 'application_decision']");
    expect(preflightCode).toContain(
      "array['method_framework', 'technical_application', 'conclusion_decision']"
    );
    expect(preflightCode).toContain(
      "case when v_job.content_type = 'mini_case' then c_case_roles else c_reading_roles end"
    );
    // Pinned to the position, not merely constrained to a list.
    expect(preflightCode).toContain("v_roles[v_index]");
  });

  it("requires exactly one option per tier", () => {
    expect(preflightCode).toContain("array[0, 300, 600, 1000]");
    expect(preflightCode).toContain("question_score_tier_set_invalid");
    // DISTINCT plus a NULL for anything off-scale, so a repeated tier, a missing
    // tier and an invented score are one comparison.
    expect(preflightCode).toMatch(
      /array_agg\(distinct public\.scored_question_tier\(o\)[\s\S]{0,400}v_tiers is distinct from c_tiers/
    );
  });

  it("requires four options, feedback and a defensible rationale", () => {
    expect(preflightCode).toContain("question_option_count_invalid");
    expect(preflightCode).toContain("question_feedback_missing");
    expect(preflightCode).toContain("question_rationale_incomplete");

    for (const field of [
      "decision_criterion",
      "excellent_reason",
      "good_limitation",
      "average_limitation",
      "bad_failure"
    ]) {
      expect(preflightCode, field).toContain(field);
    }
  });

  it("checks FR/EN parity structurally and refuses a copy", () => {
    expect(preflightCode).toContain("question_parity_id_mismatch");
    expect(preflightCode).toContain("question_parity_role_mismatch");
    expect(preflightCode).toContain("question_parity_option_missing");
    expect(preflightCode).toContain("question_parity_tier_mismatch");
    // Identical wording is the parity failure that looks like parity.
    expect(preflightCode).toContain("question_parity_text_identical");
  });

  it("never invalidates a legacy batch retroactively", () => {
    expect(preflightCode).toContain("batch_requires_scored_questions");
    expect(preflightCode).toContain("legacy_batch");
    // A declaration or a date, never "the field happens to be absent" — absence
    // is exactly what a broken new generator produces.
    expect(preflightCode).toContain("metadata->>'scored_questions'");
    expect(preflightCode).toContain("scored_question_cutover_edition");
  });

  it("makes the requirement automatic for anything new", () => {
    expect(preflightCode).toContain(
      "return v_batch.edition_date >= public.scored_question_cutover_edition();"
    );
  });

  it("is wired into the publisher's single entry point", () => {
    // A gate nothing calls is documentation.
    expect(preflightCode).toContain("create or replace function public.get_scheduled_edition_publish_plan");
    expect(preflightCode).toContain("v_questions := public.assert_edition_questions_publishable(p_edition_date);");
    expect(preflightCode).toMatch(/scored_questions_invalid[\s\S]{0,200}'ready_payload', null/);
  });

  it("does not blind-replace the editorial validator it cannot see", () => {
    // `validate_generation_output` has no file in this repository — it is one of
    // the migrations applied directly to staging. Rewriting it from memory would
    // risk rejecting every correct article at 19:00 for a reason nobody could
    // read.
    expect(preflightCode).not.toMatch(
      /create or replace function public\.validate_generation_output/i
    );
    expect(preflightCode).not.toMatch(
      /create or replace function public\.get_ready_batch_payload/i
    );
    expect(preflightCode).not.toMatch(
      /create or replace function public\.assert_edition_publishable/i
    );
  });

  it("keeps the contract out of every client role", () => {
    for (const fn of [
      "scored_question_contract()",
      "validate_generation_questions(uuid, jsonb)",
      "assert_edition_questions_publishable(date)"
    ]) {
      expect(preflightCode, fn).toContain(
        `revoke all on function public.${fn} from public, anon, authenticated;`
      );
      expect(preflightCode, fn).toContain(`grant execute on function public.${fn} to service_role;`);
    }
  });
});

describe("the generators can actually read the contract", () => {
  it("travels in the manifest the Scheduled Tasks fetch", () => {
    // A prompt file in the repository is not reachable from a ChatGPT Scheduled
    // Task. This manifest is the only thing they read.
    expect(bridge).toContain("scored_question_contract: questionContract");
    expect(bridge).toContain('supabase.rpc("scored_question_contract")');
  });

  it("is fetchable on its own for the reviewer", () => {
    expect(bridge).toContain('action === "question_contract"');
  });

  it("degrades instead of blocking an edition", () => {
    // Losing an edition because a contract could not be read would be worse than
    // the failure the contract exists to prevent.
    expect(bridge).toContain("available: false");
  });
});

describe("the publisher runs the question and assignment passes", () => {
  it("calls all three RPCs, in pipeline order", () => {
    expect(publisherEntry).toContain('supabase.rpc("publish_scheduled_staging_payload"');
    expect(publisherEntry).toContain('supabase.rpc("publish_scheduled_batch_questions"');
    expect(publisherEntry).toContain('supabase.rpc("materialize_edition_assignments"');
    expect(publisherCore).toContain(
      'export const PUBLISH_STAGES = ["content", "questions", "assignments"] as const;'
    );
  });

  it("keys the assignment pass on the payload's edition date, never the request's", () => {
    expect(publisherEntry).toContain("const editionDate = batch.edition_date;");
    expect(publisherEntry).toContain("isEditionDate(editionDate)");
  });

  it("lets only the content stage throw", () => {
    // Before the publishing transaction commits, a throw means the database is
    // untouched. After it commits, a throw would report a live edition as failed.
    expect(publisherCore).toContain("contentResult = await deps.publishContent(payload, runId);");
    expect(publisherCore).toMatch(
      /receipts\.questions = \{ status: "ok"[\s\S]{0,200}catch \(error\)[\s\S]{0,120}status: "failed"/
    );
    expect(publisherCore).toMatch(
      /receipts\.assignments = \{[\s\S]{0,220}catch \(error\)[\s\S]{0,120}status: "failed"/
    );
  });

  it("verifies both halves before a receipt can be written", () => {
    expect(publisherEntry).toContain('supabase.rpc(\n          "verify_scheduled_edition_game"');
    expect(publisherCore).toContain("ok: editorialOk && gameOk");
  });
});

describe("verifying that the edition is playable", () => {
  it("derives the expected question count from the published composition", () => {
    // 16/32, 1/2, 6/18 are the right numbers for the canonical batch and are
    // deliberately not written down: a hardcoded total can pass by coincidence
    // when the composition is wrong.
    expect(verificationCode).toContain(
      "case when p.content_type = 'mini_case' then 3 else 2 end as expected"
    );
    expect(verificationCode).not.toMatch(/\b32\b/);
    expect(verificationCode).not.toMatch(/\b18\b/);
  });

  it("requires both renderings, four options and four private grades", () => {
    expect(verificationCode).toContain("question_locale_incomplete");
    expect(verificationCode).toContain("question_option_count_mismatch");
    expect(verificationCode).toContain("question_grade_count_mismatch");
  });

  it("counts the private grade rows without returning one", () => {
    // A verification that returned the answer key to prove the answer key exists
    // would be the leak it is checking for.
    expect(verificationCode).toMatch(
      /select count\(\*\) from private\.logical_question_grades/
    );
    expect(verificationCode).not.toMatch(/select\s+g\.score_milli/);
    expect(verificationCode).not.toMatch(/rationale_md/);
    expect(verificationCode).not.toMatch(/feedback_md/);
  });

  it("fails an edition that shipped grading in client-readable metadata", () => {
    expect(verificationCode).toContain("answer_key_in_metadata");
    for (const leak of ["score_milli", "is_correct", "grade_band", "decision_criterion"]) {
      expect(verificationCode, leak).toContain(leak);
    }
  });

  it("checks the assignments, and treats no teams as normal", () => {
    expect(verificationCode).toContain("solo_assignments_missing");
    expect(verificationCode).toContain("team_roster_missing");
    expect(verificationCode).toContain("v_active_teams > 0");
  });

  it("leaves a legacy edition alone", () => {
    expect(verificationCode).toContain("edition_question_contract");
    expect(verificationCode).toContain("questions_not_expected");
  });

  it("is read-only and server-only", () => {
    expect(verificationCode).toContain("stable");
    expect(verificationCode).not.toMatch(/\b(insert into|update |delete from|create temporary)\b/i);
    expect(verificationCode).toContain(
      "revoke all on function public.verify_scheduled_edition_game(date, uuid, text) from public, anon, authenticated;"
    );
  });
});

/**
 * THE FALSE GREEN, AND WHY IT WAS ONE.
 *
 * `edition_expects_questions` used to answer "does this edition owe its readers
 * questions?" by joining `content_items` to `logical_questions`. It inferred the
 * REQUIREMENT from the PERSISTENCE, so the one failure the verification exists
 * to catch — the question stage running and writing nothing — looked exactly
 * like a legacy edition and returned `ok: true, questions_not_expected`. Staging
 * then wrote a `published` receipt and stopped re-offering the batch.
 *
 * These cases pin the shape of the fix, not just its behaviour: the requirement
 * has to arrive as a declaration, and the code that answers it must not be able
 * to reach `logical_questions` at all.
 */
describe("the requirement is declared, never inferred", () => {
  it("reads the declaration off the published metadata", () => {
    expect(declarationCode).toContain("staging_scored_question_contract");
    expect(declarationCode).toContain("edition_question_contract");
  });

  it("never consults logical_questions to decide whether questions are owed", () => {
    // The whole defect in one assertion. `edition_question_contract` and
    // `edition_expects_questions` are the only two functions in this file, and
    // neither may name the table whose presence used to be the answer.
    expect(declarationSql).not.toContain("logical_questions");
  });

  it("tells a pre-contract item apart from an undeclared one", () => {
    // Absent key: written before the contract existed, genuinely legacy, and a
    // state no new publish can re-create. Version 0: a contract-aware publisher
    // from a payload that declared nothing — a misconfiguration, not a legacy
    // edition, and it fails.
    expect(declarationCode).toContain("historical");
    expect(declarationCode).toContain("declaration_missing");
    expect(declarationCode).toContain("inconsistent");
  });

  it("refuses a payload declaring a contract version this project does not implement", () => {
    expect(declarationCode).toContain("scored_question_contract_version");
    expect(declarationCode).toMatch(/this project implements v/);
  });

  it("stamps the declaration inside the publishing transaction", () => {
    // Patched into the publisher's own metadata expression, so there is no
    // window in which an item of a questions-required edition exists without it.
    expect(declarationCode).toContain("publish_scheduled_staging_payload");
    expect(declarationCode).toContain("refusing to patch blind");
  });

  it("fails an edition that declared questions and persisted none", () => {
    expect(verificationCode).toContain("questions_missing_entirely");
    expect(verificationCode).toContain("contract_declaration_missing");
    expect(verificationCode).toContain("contract_declaration_inconsistent");
  });

  it("holds a required edition to the whole contract, not only the counts", () => {
    for (const code of [
      "question_role_invalid",
      "question_score_tier_set_invalid",
      "question_option_locale_incomplete",
      "question_locale_incomplete",
      "question_grade_count_mismatch"
    ]) {
      expect(verificationCode, code).toContain(code);
    }

    // The tier set, as the set. Two options at 1000 and no 300 is not a scored
    // question, and a count of four grades would not notice.
    expect(verificationCode).toContain("array[0, 300, 600, 1000]");
  });

  it("counts the private grades and never returns one", () => {
    expect(verificationCode).toContain("private.logical_question_grades");
    expect(verificationCode).not.toMatch(/select\s+g\.rationale_md/i);
    expect(verificationCode).not.toContain("rationale_md");
  });
});

/**
 * The declaration only works if it survives the trip.
 *
 * Staging stamps it onto `ready_payload.batch`; production reads it off
 * `p_payload->'batch'` inside the publishing transaction. Between those two
 * points sit two Edge Functions, and neither may rebuild the payload — a
 * publisher that reconstructed a `batch` object from the fields it happens to
 * care about would drop the declaration silently, and every edition would go
 * back to being unclassifiable.
 *
 * No Edge Function changed for this: they already forward it verbatim. These
 * cases exist so that stays true.
 */
describe("the declaration survives the Edge Functions", () => {
  const scheduler = read("supabase", "functions", "personews-scheduled-publisher", "core.ts");

  it("the staging publisher forwards the canonical payload untouched", () => {
    expect(scheduler).toContain("deps.publish(plan.ready_payload, runId)");
    // Never a reconstruction.
    expect(scheduler).not.toMatch(/batch:\s*\{/);
    expect(scheduler).not.toContain("scored_questions_required");
  });

  it("the production publisher passes the payload straight to the RPC", () => {
    expect(publisherEntry).toContain("p_payload: p");
    expect(publisherEntry).not.toContain("scored_questions_required");
  });

  it("so the only thing that reads the declaration is the SQL", () => {
    // If an Edge Function ever needs to know, it should ask the database rather
    // than parse the payload a second time and risk the two disagreeing.
    // Escaped, because the patch injects it as an E'' literal into the
    // publisher's own body.
    expect(declarationCode).toContain("scored_question_declaration(p_payload->");
    expect(declarationCode).toContain("batch");
  });
});
