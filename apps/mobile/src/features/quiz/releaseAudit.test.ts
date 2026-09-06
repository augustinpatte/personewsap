import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The release-candidate audit.
 *
 * Every case here corresponds to something that was actually broken when the
 * five passes were traced end to end, or to a rule that spans more files than
 * any single feature test covers. They are the checks that would have caught
 * the defects rather than the ones that describe the fix.
 *
 * The two that matter most:
 *
 *   THE DATA PATH. `readItemQuestions` reads `logical_questions` and `teams`
 *   off a content item. Nothing populated those fields, so every reader treated
 *   every article as legacy and the entire scored-question feature was dead at
 *   runtime while all of its unit tests passed. Unit tests on both halves of a
 *   seam do not test the seam.
 *
 *   THE ALREADY-READ ARTICLE. Marking an article read is what opened the quiz.
 *   On an article read before questions existed, the footer button says "Back"
 *   — and it would have opened a quiz instead of going back.
 */

const src = join(__dirname, "..", "..");
const read = (...segments: string[]) => readFileSync(join(src, ...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const dailyDropData = stripComments(read("features", "today", "dailyDropData.ts"));
const contentTypes = stripComments(read("features", "today", "contentTypes.ts"));
const newsletterReader = stripComments(read("features", "today", "readers", "NewsletterReader.tsx"));
const storyReader = stripComments(read("features", "today", "readers", "BusinessStoryReader.tsx"));
const newsletterModule = stripComments(read("features", "modules", "NewsletterModuleScreen.tsx"));
const privacyData = stripComments(read("features", "account", "privacyData.ts"));
const teamDetail = stripComments(read("features", "teams", "TeamDetailScreen.tsx"));

describe("the seam between the data layer and the readers", () => {
  it("carries questions and teams on a content item", () => {
    expect(contentTypes).toContain("logical_questions?: LogicalQuestionRef[]");
    expect(contentTypes).toContain("teams?: ContentTeamRef[]");
  });

  it("actually loads them", () => {
    // The break this whole file exists for: readItemQuestions read fields that
    // nothing wrote, so the feature was dead while its unit tests passed.
    expect(dailyDropData).toContain("fetchQuestionsByContentItemIds");
    expect(dailyDropData).toContain("fetchTeamsByContentItemIds");
    expect(dailyDropData).toContain('from("logical_questions")');
    expect(dailyDropData).toContain('from("team_question_assignments")');
  });

  it("attaches them to every mapped item", () => {
    expect(dailyDropData).toMatch(/logical_questions: questionsByContentItemId\[contentItem\.id\]/);
    expect(dailyDropData).toMatch(/teams: teamsByContentItemId\[contentItem\.id\]/);
  });

  it("loads them on the archive path too, not only on today's edition", () => {
    // An archived reading opened after a language switch has to resolve the
    // same questions and the same single attempt.
    const singleItemPath = dailyDropData.slice(dailyDropData.indexOf("synthesizeDropItem"));

    expect(singleItemPath).toContain("fetchQuestionsByContentItemIds");
  });

  it("matches questions on the logical key, not on the row id", () => {
    // The FR and EN renderings are two rows sharing one content_logical_key.
    expect(dailyDropData).toContain("readContentLogicalKey");
    expect(dailyDropData).toContain('"staging_job_id", "catalog_entry_id", "entry_key"');
    expect(dailyDropData).toContain('.in("content_logical_key"');
  });

  it("fetches once per edition, not once per item", () => {
    // 23 items × 2 queries each would make the Newsletter tab take a second to
    // draw. Both fetchers take the whole array.
    expect(dailyDropData).toMatch(/fetchQuestionsByContentItemIds\(assignedContentItems\)/);
    expect(dailyDropData).toMatch(/contentItems: assignedContentItems/);
  });

  it("degrades to no-quiz rather than to an error screen", () => {
    // A reader whose questions failed to load still gets the article, which is
    // the product. An error screen would lose both.
    const questionFetcher = dailyDropData.slice(
      dailyDropData.indexOf("async function fetchQuestionsByContentItemIds"),
      dailyDropData.indexOf("async function fetchTeamsByContentItemIds")
    );

    expect(questionFetcher).toContain("if (error || !data) {");
    expect(questionFetcher).toContain("return {};");
    expect(questionFetcher).not.toContain("throw");
  });
});

describe("nothing is forced on content read before the rollout", () => {
  it.each([
    ["newsletter", newsletterReader],
    ["business story", storyReader]
  ])("%s only opens the quiz on a fresh completion", (_name, reader) => {
    // The bug: the footer of an already-read article says "Back", and Back must
    // go back. The quiz moved inside the `if (!completed)` branch.
    const finish = reader.slice(reader.indexOf("const onFinish"), reader.indexOf("if (showQuiz)"));

    expect(finish).toMatch(/if \(!completed\) \{[\s\S]*?setShowQuiz\(true\)[\s\S]*?\}/);
    expect(finish.trimEnd().endsWith("};")).toBe(true);
  });

  it.each([
    ["newsletter", newsletterReader],
    ["business story", storyReader]
  ])("%s offers the quiz beside the button, never behind it", (_name, reader) => {
    expect(reader).toContain("wasAlreadyRead");
    expect(reader).toContain("continueChallenge");
  });

  it("captures the already-read state once, with the other hooks", () => {
    // Lazy initialiser, so it is read on the first render only — and declared
    // above the missing-item guard, because a hook after an early return is a
    // rules-of-hooks violation and a real crash risk when an item disappears
    // between renders.
    expect(newsletterReader).toContain(
      'const [wasAlreadyRead] = useState(() => isItemComplete(item?.id ?? ""))'
    );

    const hooks = newsletterReader.slice(0, newsletterReader.indexOf("if (!item"));

    expect(hooks).toContain("wasAlreadyRead");
  });

  it("shows Continue challenge in the list only when questions remain", () => {
    expect(newsletterModule).toContain("itemHasQuestions(article)");
    expect(newsletterModule).toContain("continueChallenge");
  });
});

describe("Team-first merge is actually wired", () => {
  it("runs on the Newsletter list", () => {
    // Built and tested in an earlier pass, but never called until now.
    expect(newsletterModule).toContain("mergeTeamAndPersonalContent");
    expect(newsletterModule).toContain("mergedItems");
  });

  it("derives team assignments from the item's own teams", () => {
    expect(newsletterModule).toMatch(/\(item\.teams \?\? \[\]\)\.length > 0/);
    expect(newsletterModule).toMatch(/\(item\.teams \?\? \[\]\)\.length === 0/);
  });

  it("badges both the lead and the secondary rows", () => {
    expect((newsletterModule.match(/<TeamBadge/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("the database stays the source of truth", () => {
  it("refetches the leaderboard on focus, not only on a broadcast", () => {
    // A Broadcast can be missed: dropped socket, backgrounded app, event during
    // unmount. The channel makes an update fast; this makes it correct.
    expect(teamDetail).toContain("AppState.addEventListener");
    expect(teamDetail).toMatch(/next === "active"[\s\S]{0,80}load\(range\)/);
  });
});

describe("the data export covers what the feature added", () => {
  it("includes the reader's Teams data", () => {
    for (const table of [
      "team_members",
      "question_attempts",
      "team_member_edition_scores",
      "user_blocks",
      "user_reports"
    ]) {
      expect(privacyData, table).toContain(table);
    }
  });

  it("never exports the answer key", () => {
    // A data export must not become the way grading leaves the server.
    for (const forbidden of ["logical_question_grades", "grade_band", "rationale", "private."]) {
      expect(privacyData, forbidden).not.toContain(forbidden);
    }
  });

  it("exports the reader's own reports and not reports about them", () => {
    // Exposing who reported you is how a report system becomes retaliation.
    expect(privacyData).toContain('.eq("reporter_id", userId)');
    expect(privacyData).not.toMatch(/user_reports[\s\S]{0,200}eq\("reported_user_id", userId\)/);
  });
});

describe("account deletion cannot be blocked by team ownership", () => {
  const migration = readFileSync(
    join(src, "..", "..", "..", "supabase", "migrations", "20260906098000_team_ownership_and_deletion.sql"),
    "utf8"
  );

  it("resolves ownership before the profile row goes", () => {
    // teams.owner_id is ON DELETE RESTRICT, so without this a Team owner could
    // not delete their account at all — a GDPR obligation failing closed.
    expect(migration).toContain("BEFORE DELETE ON public.profiles");
    expect(migration).toContain("resolve_team_ownership_on_profile_delete");
  });

  it("hands the team on rather than deleting other people's history", () => {
    expect(migration).toContain("ORDER BY m.joined_at");
    expect(migration).toContain("SET owner_id = v_successor");
  });

  it("adds the transfer and remove functions the UI already promised", () => {
    expect(migration).toContain("public.transfer_team_ownership");
    expect(migration).toContain("public.remove_team_member");
  });

  it("removes a member by closing the stint, never by deleting it", () => {
    const remove = migration.slice(migration.indexOf("remove_team_member"));

    expect(remove).toContain("SET left_at = v_removed_at");
    expect(remove).not.toMatch(/DELETE FROM public\.team_members/);
  });

  it("keeps every new function away from anon and PUBLIC", () => {
    for (const fn of ["transfer_team_ownership", "remove_team_member"]) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[^;]*FROM PUBLIC`));
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[^;]*FROM anon`));
    }
  });
});

describe("no client path can read the answer key", () => {
  it("keeps the private schema out of every mobile file", () => {
    const files = [
      join(src, "features", "quiz", "quizData.ts"),
      join(src, "features", "teams", "teamsData.ts"),
      join(src, "features", "today", "dailyDropData.ts"),
      join(src, "features", "account", "privacyData.ts")
    ];

    for (const file of files) {
      // Comments stripped: prose explaining why grading is NOT read is exactly
      // what should be there, and flagging it would train the next person to
      // delete the explanation rather than keep the property.
      const source = stripComments(readFileSync(file, "utf8"));

      expect(source, file).not.toMatch(/logical_question_grades/);
      expect(source, file).not.toMatch(/logical_question_option_feedback/);
      expect(source, file).not.toMatch(/\.schema\("private"\)/);
    }
  });

  it("never selects a score column from a question table", () => {
    expect(dailyDropData).not.toMatch(/score_milli/);
    // The question fetch reads identity and ordering only — no text, no grade.
    expect(dailyDropData).toContain(
      "id,content_logical_key,content_type,question_sequence,question_role"
    );
  });
});
