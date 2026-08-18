import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { getModuleCopy } from "./moduleCopy";

function shapeOf(value: unknown, path = ""): string[] {
  if (typeof value !== "object" || value === null) {
    return [path];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    shapeOf(child, path ? `${path}.${key}` : key)
  );
}

describe("module copy language isolation", () => {
  it("FR and EN expose exactly the same keys", () => {
    expect(shapeOf(getModuleCopy("fr")).sort()).toEqual(
      shapeOf(getModuleCopy("en")).sort()
    );
  });

  it("resolves an unset language to EN, never to a mixed state", () => {
    expect(getModuleCopy(null).common.todayView).toBe(
      getModuleCopy("en").common.todayView
    );
    expect(getModuleCopy(undefined).path.title).toBe(getModuleCopy("en").path.title);
  });

  it("keeps the four destinations distinct in both languages", () => {
    for (const language of ["fr", "en"] as const) {
      const copy = getModuleCopy(language);
      const titles = [
        copy.newsletter.title,
        copy.stories.title,
        copy.cases.title,
        copy.path.title
      ];

      expect(new Set(titles).size).toBe(4);
    }
  });
});

describe("learning path is not the concept content type", () => {
  it("the Parcours tab never renders concept content", () => {
    const source = readFileSync(join(__dirname, "PathModuleScreen.tsx"), "utf8");

    expect(source).not.toMatch(/key_concept/);
    expect(source).not.toMatch(/ConceptReader/);
    expect(source).toMatch(/useLearningPath/);
  });
});

describe("the Parcours header is decoupled from the edition calendar", () => {
  const source = readFileSync(join(__dirname, "PathModuleScreen.tsx"), "utf8");

  it("shows a stable eyebrow instead of the newsletter date", () => {
    // The path is self-paced: labelling it with drop_date told the reader their
    // progress belonged to today's edition.
    expect(source).not.toMatch(/drop_date/);
    expect(source).not.toMatch(/formatDropDate/);
    expect(source).toMatch(/eyebrow=\{copy\.path\.eyebrow\}/);
  });

  it("names the path in both languages, without a date", () => {
    expect(getModuleCopy("fr").path.eyebrow).toBe("Parcours personnel");
    expect(getModuleCopy("en").path.eyebrow).toBe("Personal path");

    for (const language of ["fr", "en"] as const) {
      expect(getModuleCopy(language).path.eyebrow).not.toMatch(/\d/);
    }
  });

  it("keeps the first session named as such in both languages", () => {
    expect(getModuleCopy("fr").path.startFirst).toBe("Commencer la première session");
    expect(getModuleCopy("en").path.startFirst).toBe("Start your first session");
    expect(getModuleCopy("fr").path.sessionLabel(1)).toBe("Session 1");
    expect(getModuleCopy("en").path.sessionLabel(1)).toBe("Session 1");
  });
});

describe("archive search paging stays explicit", () => {
  const source = readFileSync(join(__dirname, "ItemArchiveList.tsx"), "utf8");

  it("names the search paging control in both languages", () => {
    expect(getModuleCopy("fr").common.loadMoreResults).toBe("Afficher plus de résultats");
    expect(getModuleCopy("en").common.loadMoreResults).toBe("Load more results");
    // The browse control keeps its own wording: two different actions.
    expect(getModuleCopy("fr").common.loadMoreResults).not.toBe(
      getModuleCopy("fr").common.loadEarlier
    );
  });

  it("never loads a further page by scrolling", () => {
    expect(source).not.toMatch(/onEndReached/);
    expect(source).not.toMatch(/onEndReachedThreshold/);
    expect(source).toMatch(/search\.loadMore/);
    expect(source).toMatch(/loadMoreResults/);
  });

  it("hides the control once there is nothing left to load", () => {
    expect(source).toMatch(/if \(!search\.hasMore && !search\.loadMoreError\)/);
  });
});
