import { describe, expect, it } from "vitest";

import {
  isSafeExternalUrl,
  parseMarkdownBlocks,
  parseInlineSegments,
  stripMarkdownInline
} from "./markdown";

function renderedText(markdown: string): string {
  return parseMarkdownBlocks(markdown)
    .map((block) => block.segments.map((segment) => segment.text).join(""))
    .join("\n");
}

describe("parseMarkdownBlocks", () => {
  it("splits paragraphs on blank lines and collapses soft wraps", () => {
    const blocks = parseMarkdownBlocks("First line\ncontinues here.\n\nSecond paragraph.");

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].segments[0].text).toBe("First line continues here.");
    expect(blocks[1].segments[0].text).toBe("Second paragraph.");
  });

  it("never renders raw bold markers", () => {
    const text = renderedText("Revenue grew to **$4.2B** in Q2, a **21%** jump.");

    expect(text).not.toContain("**");
    expect(text).toBe("Revenue grew to $4.2B in Q2, a 21% jump.");
  });

  it("marks bold segments", () => {
    const blocks = parseMarkdownBlocks("A **key fact** here.");
    const segments = blocks[0].segments;

    expect(segments).toEqual([
      { text: "A " },
      { text: "key fact", bold: true },
      { text: " here." }
    ]);
  });

  it("supports __bold__ and *italic* without leaking markers", () => {
    const text = renderedText("__Strong__ and *subtle* words.");

    expect(text).toBe("Strong and subtle words.");
    const segments = parseMarkdownBlocks("__Strong__ and *subtle* words.")[0].segments;
    expect(segments[0]).toEqual({ text: "Strong", bold: true });
    expect(segments[2]).toEqual({ text: "subtle", italic: true });
  });

  it("parses [label](url) links with http/https only", () => {
    const segments = parseMarkdownBlocks(
      "Read [the filing](https://example.com/doc) today."
    )[0].segments;

    expect(segments[1]).toEqual({
      text: "the filing",
      href: "https://example.com/doc"
    });
  });

  it("renders unsafe link schemes as plain text with no href", () => {
    const segments = parseMarkdownBlocks(
      "Do not [click](javascript:alert(1)) this."
    )[0].segments;

    expect(segments.some((segment) => segment.href)).toBe(false);
    expect(segments.map((segment) => segment.text).join("")).toBe(
      "Do not click this."
    );
  });

  it("never renders raw link syntax", () => {
    const text = renderedText("See [source](https://example.org).");

    expect(text).not.toContain("](");
    expect(text).not.toContain("[");
  });

  it("parses bullet lists into bullet blocks", () => {
    const blocks = parseMarkdownBlocks("- First point\n- **Second** point");

    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("bullet");
    expect(blocks[1].type).toBe("bullet");
    expect(blocks[1].segments[0]).toEqual({ text: "Second", bold: true });
  });

  it("handles bold inside links and nested emphasis", () => {
    const segments = parseMarkdownBlocks("**Bold with *italic* inside**")[0].segments;

    expect(segments).toEqual([
      { text: "Bold with ", bold: true },
      { text: "italic", bold: true, italic: true },
      { text: " inside", bold: true }
    ]);
  });

  it("returns plain paragraphs untouched", () => {
    const blocks = parseMarkdownBlocks("Nothing special here, 3*4 is twelve.");

    expect(blocks).toHaveLength(1);
    expect(blocks[0].segments.map((segment) => segment.text).join("")).toContain(
      "Nothing special here"
    );
  });

  it("returns an empty list for empty input", () => {
    expect(parseMarkdownBlocks("")).toEqual([]);
    expect(parseMarkdownBlocks("   \n\n  ")).toEqual([]);
  });
});

describe("parseInlineSegments", () => {
  it("prefers bold over italic at the same index", () => {
    const segments = parseInlineSegments("**both**");

    expect(segments).toEqual([{ text: "both", bold: true }]);
  });
});

describe("stripMarkdownInline", () => {
  it("strips all markers for preview surfaces", () => {
    expect(stripMarkdownInline("**Bold** and [link](https://a.b) and *italic*.")).toBe(
      "Bold and link and italic."
    );
  });
});

describe("isSafeExternalUrl", () => {
  it("accepts http and https", () => {
    expect(isSafeExternalUrl("https://example.com/x?y=1")).toBe(true);
    expect(isSafeExternalUrl("http://example.com")).toBe(true);
  });

  it("rejects every other scheme", () => {
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("mailto:a@b.c")).toBe(false);
    expect(isSafeExternalUrl("ftp://example.com")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
  });
});
