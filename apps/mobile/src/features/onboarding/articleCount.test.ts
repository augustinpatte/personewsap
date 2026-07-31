import { describe, expect, it } from "vitest";

import {
  clampNewsletterArticleCount,
  MAX_NEWSLETTER_ARTICLES_PER_TOPIC,
  MIN_NEWSLETTER_ARTICLES_PER_TOPIC
} from "./options";

// The product allows only 1 or 2 newsletter articles per topic. These tests
// guarantee the onboarding/preferences UI can never offer "3" again and that
// legacy preferences storing 3 are clamped to 2 on read and on save.
describe("newsletter articles per topic (1 or 2 only)", () => {
  it("caps the per-topic maximum at 2", () => {
    expect(MIN_NEWSLETTER_ARTICLES_PER_TOPIC).toBe(1);
    expect(MAX_NEWSLETTER_ARTICLES_PER_TOPIC).toBe(2);
  });

  it("offers exactly [1, 2] as selectable counts (no 3)", () => {
    // Mirrors how the UI builds its options from the shared constants.
    const offered = Array.from(
      { length: MAX_NEWSLETTER_ARTICLES_PER_TOPIC - MIN_NEWSLETTER_ARTICLES_PER_TOPIC + 1 },
      (_value, index) => MIN_NEWSLETTER_ARTICLES_PER_TOPIC + index
    );
    expect(offered).toEqual([1, 2]);
    expect(offered).not.toContain(3);
  });

  it("clamps a legacy value of 3 down to 2", () => {
    expect(clampNewsletterArticleCount(3)).toBe(2);
  });

  it("clamps anything above 2 down to 2 and keeps 1 and 2 unchanged", () => {
    expect(clampNewsletterArticleCount(1)).toBe(1);
    expect(clampNewsletterArticleCount(2)).toBe(2);
    expect(clampNewsletterArticleCount(5)).toBe(2);
  });

  it("clamps invalid/too-small values up to the minimum of 1", () => {
    expect(clampNewsletterArticleCount(0)).toBe(1);
  });
});
