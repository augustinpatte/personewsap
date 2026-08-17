/**
 * Minimal, safe Markdown model for reader bodies.
 *
 * The content engine writes `body_md` with a small dialect: paragraphs split by
 * blank lines, `**bold**` for key facts, occasionally `*italic*`, inline
 * `[label](url)` links and plain source URLs. This module parses exactly that
 * dialect into typed blocks/segments so the reader never shows raw `**`, `__`
 * or `[label](url)` syntax, without pulling a full Markdown dependency.
 *
 * Only http/https URLs are ever considered links; anything else renders as
 * plain text and can never be executed.
 */

export type InlineSegment = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Present only for validated http/https URLs. */
  href?: string;
};

export type MarkdownBlock =
  | { type: "paragraph"; segments: InlineSegment[] }
  | { type: "bullet"; segments: InlineSegment[] }
  | { type: "heading"; segments: InlineSegment[] };

const LINK_PATTERN = /\[([^\]]+)\]\(([^\s]+)\)/;
const BOLD_STAR_PATTERN = /\*\*((?:[^*]|\*(?!\*))+?)\*\*/;
const BOLD_UNDERSCORE_PATTERN = /__((?:[^_]|_(?!_))+?)__/;
const ITALIC_STAR_PATTERN = /\*([^*\s][^*]*?)\*/;
const BULLET_LINE_PATTERN = /^\s*[-*•]\s+/;
const HEADING_LINE_PATTERN = /^\s*#{1,6}\s+/;

export function isSafeExternalUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url.trim());
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const rawBlocks = (markdown ?? "").split(/\n{2,}/);
  const blocks: MarkdownBlock[] = [];

  for (const rawBlock of rawBlocks) {
    const lines = rawBlock.split("\n").map((line) => line.trim()).filter(Boolean);

    if (lines.length === 0) {
      continue;
    }

    const isBulletBlock = lines.every((line) => BULLET_LINE_PATTERN.test(line));

    if (isBulletBlock) {
      for (const line of lines) {
        blocks.push({
          type: "bullet",
          segments: parseInlineSegments(line.replace(BULLET_LINE_PATTERN, ""))
        });
      }
      continue;
    }

    if (lines.length === 1 && HEADING_LINE_PATTERN.test(lines[0])) {
      blocks.push({
        type: "heading",
        segments: parseInlineSegments(lines[0].replace(HEADING_LINE_PATTERN, ""))
      });
      continue;
    }

    // Regular paragraph: single newlines inside a block are soft wraps.
    const text = lines.join(" ").replace(/\s+/g, " ").trim();

    if (text.length > 0) {
      blocks.push({ type: "paragraph", segments: parseInlineSegments(text) });
    }
  }

  return blocks;
}

type InlineStyle = { bold?: boolean; italic?: boolean };

export function parseInlineSegments(
  text: string,
  style: InlineStyle = {}
): InlineSegment[] {
  if (text.length === 0) {
    return [];
  }

  const candidates: Array<{
    index: number;
    length: number;
    segments: InlineSegment[];
  }> = [];

  const link = LINK_PATTERN.exec(text);
  if (link) {
    const [raw, label, url] = link;
    candidates.push({
      index: link.index,
      length: raw.length,
      segments: isSafeExternalUrl(url)
        ? [{ text: label, ...style, href: url.trim() }]
        : parseInlineSegments(label, style)
    });
  }

  const boldStar = BOLD_STAR_PATTERN.exec(text);
  if (boldStar) {
    candidates.push({
      index: boldStar.index,
      length: boldStar[0].length,
      segments: parseInlineSegments(boldStar[1], { ...style, bold: true })
    });
  }

  const boldUnderscore = BOLD_UNDERSCORE_PATTERN.exec(text);
  if (boldUnderscore) {
    candidates.push({
      index: boldUnderscore.index,
      length: boldUnderscore[0].length,
      segments: parseInlineSegments(boldUnderscore[1], { ...style, bold: true })
    });
  }

  const italicStar = ITALIC_STAR_PATTERN.exec(text);
  if (italicStar) {
    candidates.push({
      index: italicStar.index,
      length: italicStar[0].length,
      segments: parseInlineSegments(italicStar[1], { ...style, italic: true })
    });
  }

  if (candidates.length === 0) {
    return [{ text, ...style }];
  }

  // Earliest match wins; on a tie (e.g. ** vs * at the same index) the longer
  // marker wins so bold is never mis-read as italic.
  candidates.sort((a, b) => a.index - b.index || b.length - a.length);
  const match = candidates[0];

  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match.length);

  return [
    ...(before.length > 0 ? [{ text: before, ...style }] : []),
    ...match.segments,
    ...parseInlineSegments(after, style)
  ];
}

/**
 * Plain-text projection of a Markdown string: markers removed, link labels
 * kept. Used for previews, summaries and any single-line surfaces.
 */
export function stripMarkdownInline(text: string): string {
  return parseMarkdownBlocks(text)
    .map((block) => block.segments.map((segment) => segment.text).join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
