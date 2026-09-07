import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Where Team content shows up in the interface, and what it must not become.
 *
 * The rules with product weight are all about restraint. A Team article is
 * still a newsletter article: it sits in the same editorial column, marked by
 * the same quiet line, and nothing about it may turn the Newsletter tab into a
 * game board. And the merge lives in the data layer, so a screen that renders
 * one of these lists cannot invent a different order from the one edition
 * progress is counted over.
 *
 * Source assertions, in the idiom this repository already uses for React Native
 * components (see visualPolish.test.ts and quizFlowContract.test.ts): the
 * mobile tree cannot be rendered under jsdom, so the wiring is pinned by
 * reading it.
 */

const featuresDir = join(__dirname, "..");
const read = (...segments: string[]) => readFileSync(join(featuresDir, ...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const newsletter = stripComments(read("modules", "NewsletterModuleScreen.tsx"));
const cases = stripComments(read("modules", "MiniCasesModuleScreen.tsx"));
const stories = stripComments(read("modules", "StoriesModuleScreen.tsx"));
const archiveList = stripComments(read("modules", "ItemArchiveList.tsx"));
const badge = stripComments(read("quiz", "TeamBadge.tsx"));
const dropContext = stripComments(read("today", "DailyDropContext.tsx"));
const dailyDropData = stripComments(read("today", "dailyDropData.ts"));

describe("the Newsletter list", () => {
  it("renders the order the data layer decided, and does not re-derive it", () => {
    expect(newsletter).toContain("const articles = drop.items.newsletter;");
    expect(newsletter).not.toContain("mergeTeamAndPersonalContent");
    expect(newsletter).not.toContain("sort(");
  });

  it("badges the lead and the secondary rows", () => {
    expect((newsletter.match(/<TeamBadge/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("the Mini cases list", () => {
  it("reads the plural field", () => {
    // The singular one could only ever show one of the reader's cases, and
    // which one was an accident of iteration order.
    expect(cases).toContain("drop.items.mini_cases");
    expect(cases).not.toMatch(/drop\.items\.mini_case\b/);
  });

  it("renders every case rather than the first", () => {
    expect(cases).toMatch(/miniCases\.map\(\(miniCase\) => \(\s*<MiniCaseCard/);
  });

  it("badges a Team case with the same component the Newsletter uses", () => {
    expect(cases).toContain("<TeamBadge");
    expect(cases).toContain('from "../quiz/TeamBadge"');
  });

  it("reads every solved case's result in one pass, not one per card", () => {
    // A card that fetched its own score would be an N+1 in a list.
    expect(cases).toMatch(/for \(const solvedId of solvedIds\)/);
    expect(cases).not.toMatch(/useEffect[\s\S]{0,200}readMiniCaseResponse\(challenge/);
  });
});

describe("Business Stories stay Solo", () => {
  it("carry no Team concept at all", () => {
    for (const forbidden of ["TeamBadge", "teams", "team_id"]) {
      expect(stories, forbidden).not.toContain(forbidden);
    }
  });
});

describe("the archive keeps a Team reading recognisable", () => {
  it("badges an archived row with the same component", () => {
    expect(archiveList).toContain("<TeamBadge");
    expect(archiveList).toMatch(/teams=\{item\.teams \?\? \[\]\}/);
  });
});

describe("the badge", () => {
  it("names up to two Teams, then counts the rest", () => {
    // Two names is a badge; four is a paragraph in the middle of a headline.
    expect(badge).toContain("const NAMED_TEAM_LIMIT = 2");
    expect(badge).toMatch(/names\.slice\(0, NAMED_TEAM_LIMIT\)/);
    expect(badge).toMatch(/copy\.teamMore\(overflow\)/);
  });

  it("stands in for a moderated name rather than blanking the row", () => {
    expect(badge).toMatch(/team\.name \?\? copy\.teamHidden/);
  });

  it("spells the overflow out for assistive technology", () => {
    // "+2" is not a sentence, and a VoiceOver reader gets no other cue.
    expect(badge).toContain("copy.teamMoreSpoken(overflow)");
    expect(badge).toContain("accessibilityLabel={accessibilityLabel}");
  });

  it("introduces no second palette and no game furniture", () => {
    expect(badge).not.toMatch(/#[0-9a-f]{6}/i);
    expect(badge).not.toMatch(/gradient|confetti|trophy|emoji|\p{Extended_Pictographic}/iu);
    expect(badge).toContain("tokens.space");
    expect(badge).toContain("useThemedStyles");
  });
});

describe("edition progress counts one session, not two", () => {
  it("counts the merged list, so an overlap is counted once", () => {
    // The provider counts over the same list the screens render. That is only
    // safe because the merge happens before it — a screen-level merge would
    // leave this counting an article that appears once as two.
    expect(dailyDropData).toContain("function orderEditionItems");
    expect(dropContext).toContain("flattenDailyDropItems(state.drop)");
  });

  it("treats a reading completed in the other language as completed", () => {
    // Team content has no assigned id, so the row on screen moves with the
    // reading language; asking only about the current one would report an
    // article read this morning as unread.
    expect(dropContext).toMatch(/translation_ids \?\? \[\]/);
    expect(dropContext).toMatch(/\.\.\.\(item\.translation_ids \?\? \[\]\)/);
  });
});
