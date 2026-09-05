import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Where the Sources section appears, and where it must not.
 *
 * Sources are attached to the content item, and every reader — today's edition,
 * the archive, the library, a direct link — receives that item through the same
 * `useDailyDrop()` context. So there is one component, wired once per reader,
 * and archived content is exactly as transparent as this morning's edition
 * without a second code path to keep in step.
 *
 * The one placement rule with teeth is the Mini Case: a source list above the
 * questions would hand the reader the answer before they have committed to one.
 */

const readersDir = __dirname;
const read = (...segments: string[]) =>
  readFileSync(join(readersDir, ...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const newsletter = stripComments(read("NewsletterReader.tsx"));
const story = stripComments(read("BusinessStoryReader.tsx"));
const concept = stripComments(read("ConceptReader.tsx"));
const miniCase = stripComments(read("MiniCaseReader.tsx"));
const sourceList = stripComments(read("SourceList.tsx"));
const readerItemProvider = stripComments(read("..", "ReaderItemProvider.tsx"));
const dailyDropData = stripComments(read("..", "dailyDropData.ts"));

/** Where a marker sits in a file, as a fraction of its length. */
function positionOf(source: string, marker: string): number {
  const index = source.indexOf(marker);

  expect(index, marker).toBeGreaterThan(-1);

  return index;
}

describe("every reading surfaces its sources", () => {
  it.each([
    ["newsletter article", newsletter],
    ["business story", story],
    ["key concept", concept],
    ["mini case", miniCase]
  ])("%s renders the shared Sources section", (_name, source) => {
    expect(source).toContain("<SourceList");
    expect(source).toMatch(/sources=\{(item|challenge)\.sources\}/);
  });

  it("passes the reader's language, so the controls follow the app", () => {
    for (const source of [newsletter, story, concept, miniCase]) {
      expect(source).toMatch(/<SourceList language=\{language\}/);
    }
  });

  it("uses one component everywhere rather than a section per reader", () => {
    for (const source of [newsletter, story, concept, miniCase]) {
      expect(source).not.toMatch(/["']Sources["']/);
    }

    expect(sourceList).toContain("getSourcesCopy");
  });
});

describe("where the section sits", () => {
  it("comes after the newsletter's closing argument", () => {
    expect(positionOf(newsletter, "<SourceList")).toBeGreaterThan(
      positionOf(newsletter, "copy.whyItMatters")
    );
  });

  it("comes after the business story's lesson", () => {
    // Visually secondary and last: the story is what the reader came for.
    expect(positionOf(story, "<SourceList")).toBeGreaterThan(
      positionOf(story, "copy.lesson")
    );
  });

  it("comes after the concept's closing block", () => {
    expect(positionOf(concept, "<SourceList")).toBeGreaterThan(
      positionOf(concept, "copy.whyItMatters")
    );
  });
});

describe("the mini case", () => {
  it("shows sources only once the case is over", () => {
    // Three flows — the live quiz, the read-only review of a completed case,
    // and the legacy single-question case — and one Sources render in each.
    expect(miniCase.match(/<SourceList/g)).toHaveLength(3);
  });

  it("never renders them in the shared intro, which precedes the questions", () => {
    const introStart = positionOf(miniCase, "function CaseIntro");
    const introEnd = miniCase.indexOf("function ", introStart + 1);

    expect(miniCase.slice(introStart, introEnd)).not.toContain("<SourceList");
  });

  it("puts the quiz flow's section behind the results screen", () => {
    // renderResults() only runs when showResults is true, so a reader who has
    // not answered cannot see the citations.
    const resultsStart = positionOf(miniCase, "function renderResults");
    const resultsEnd = positionOf(miniCase, "function renderFooter");
    const results = miniCase.slice(resultsStart, resultsEnd);

    expect(results).toContain("<SourceList");
    expect(results.indexOf("<SourceList")).toBeGreaterThan(
      results.indexOf("copy.takeaway")
    );
  });

  it("puts the legacy flow's section behind the debrief phase", () => {
    const debriefStart = positionOf(miniCase, "function renderDebrief");
    const debriefEnd = miniCase.indexOf("function renderFooter", debriefStart);
    const debrief = miniCase.slice(debriefStart, debriefEnd);

    expect(debrief).toContain("<SourceList");
    expect(miniCase).toMatch(/phase === "debrief" \? renderDebrief\(\) : null/);
  });
});

describe("the source data path", () => {
  it("is the same one for today's edition and for the archive", () => {
    // ReaderItemProvider serves an archived or library item through the very
    // context the today provider uses, so a reader opening a three-week-old
    // story gets the same item shape — sources included — as this morning's.
    expect(readerItemProvider).toContain("fetchContentItemById");
    expect(readerItemProvider).toContain("DailyDropContext.Provider");
    expect(dailyDropData).toContain("fetchSourcesByContentItemIds");
  });

  it("reads sources against the assigned item id, which is what RLS grants", () => {
    // The FR and EN renderings of one editorial job are two content_items rows.
    // Only the assigned row's source links are readable — the translation's are
    // not — so the fetch is keyed on the assigned id whichever language is
    // being displayed.
    expect(dailyDropData).toMatch(
      /fetchSourcesByContentItemIds\(\[contentItemId\]\)/
    );
    expect(dailyDropData).toMatch(/fetchSourcesByContentItemIds\(contentItemIds\)/);
  });

  it("never invents a publisher or a title for a record that has none", () => {
    expect(dailyDropData).not.toContain("Unknown publisher");
    expect(dailyDropData).toMatch(/publisher: source\.publisher,/);
    expect(dailyDropData).toMatch(/title: source\.title,/);
  });
});

describe("when sources cannot be shown", () => {
  it("renders nothing rather than an empty heading", () => {
    expect(sourceList).toMatch(/if \(displaySources\.length === 0\) \{\s*\n\s*return null;/);
  });

  it("leaves the reading readable when the source query failed", () => {
    // Sources arrive on the item; a failed or refused source read leaves the
    // field undefined and the component returns null. No reader branches on it,
    // so nothing above can be blocked by it.
    for (const source of [newsletter, story, concept, miniCase]) {
      expect(source).not.toMatch(/sources.*(\?\?|&&).*(EmptyState|error|Error)/);
    }

    expect(sourceList).toContain("sources: SourceMetadata[] | null | undefined");
  });
});

describe("opening a source", () => {
  it("is announced as a link, with the source named", () => {
    expect(sourceList).toContain('accessibilityRole="link"');
    expect(sourceList).toMatch(/accessibilityLabel=\{copy\.openSource\(name\)\}/);
  });

  it("calls Linking.openURL through its receiver", () => {
    // The same unbound-method trap that broke the Learning Path buttons.
    expect(sourceList).toMatch(/Linking\.openURL\(source\.url\)/);
    expect(sourceList).not.toMatch(/openUrl:\s*Linking\.openURL/);
  });

  it("never surfaces a raw platform error", () => {
    for (const raw of ["Unable to open URL", "unsupported URL", "error.message"]) {
      expect(sourceList).not.toContain(raw);
    }
  });

  it("puts the link on the clipboard when it cannot be opened", () => {
    expect(sourceList).toContain("Clipboard.setStringAsync(source.url)");
    expect(sourceList).toContain("copy.openFailed");
    // And says so honestly when even the clipboard refused.
    expect(sourceList).toContain("copy.openFailedWithoutCopy");
  });

  it("keeps the touch target reachable", () => {
    expect(sourceList).toMatch(/paddingVertical: tokens\.space\.md/);
    expect(sourceList).toMatch(/minHeight: 20/);
  });
});

describe("the visual restraint of the section", () => {
  it("is text and a rule, with no fetched imagery", () => {
    for (const forbidden of [
      "favicon",
      "logo",
      "Image",
      "LinearGradient",
      "horizontal",
      "FlatList"
    ]) {
      expect(sourceList, forbidden).not.toContain(forbidden);
    }
  });
});
