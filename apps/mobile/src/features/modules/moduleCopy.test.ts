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
