import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the reader line-rhythm bug.
 *
 * The original DropCapParagraph nested an oversized glyph (fontSize 58 /
 * lineHeight 52) inside the `read` paragraph (fontSize 18 / lineHeight 30),
 * which inflated the first paragraph's line boxes on device. The fix is
 * structural: reader bodies render exclusively through MarkdownBody, whose
 * nested emphasis spans may set fontWeight / fontStyle / color but never
 * fontSize or lineHeight. These tests pin that architecture down.
 */

const readersDir = __dirname;

describe("reader typography architecture", () => {
  it("has no DropCapParagraph component anymore", () => {
    expect(existsSync(join(readersDir, "DropCapParagraph.tsx"))).toBe(false);
  });

  it("no reader references a drop cap", () => {
    for (const file of readerSourceFiles()) {
      expect(readFileSync(join(readersDir, file), "utf8")).not.toMatch(/DropCap/);
    }
  });

  it("MarkdownBody never overrides fontSize or lineHeight on inline spans", () => {
    const source = readFileSync(join(readersDir, "MarkdownBody.tsx"), "utf8");

    expect(source).not.toMatch(/fontSize/);
    expect(source).not.toMatch(/lineHeight/);
  });

  it("readers no longer render body_md through the raw paragraph splitter", () => {
    for (const file of readerSourceFiles()) {
      expect(readFileSync(join(readersDir, file), "utf8")).not.toMatch(
        /splitParagraphs/
      );
    }
  });
});

function readerSourceFiles(): string[] {
  return readdirSync(readersDir).filter((file) => file.endsWith(".tsx"));
}
