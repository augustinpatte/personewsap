import { describe, expect, it } from "vitest";

import type { DailyDropPayload, GeneratedContentItem } from "../domain.js";
import { sanitizeLlmDailyDropPayload } from "./llmSanitizer.js";

/**
 * Invented attribution.
 *
 * In the live proof the source packet held a single France24 item, and the
 * model still closed the article with "Sources : Reuters (date), Financial
 * Times (date)". No prompt wording removes that risk entirely, so the footer is
 * not trusted at all: it is stripped and rebuilt from the real metadata behind
 * the item's allowed source URLs. A publisher that is not in the packet has
 * nothing to be rebuilt from and therefore cannot survive.
 */

const FRANCE24 = {
  url: "https://www.france24.com/fr/economie/article-1",
  title: "Une décision de politique monétaire",
  publisher: "France24",
  published_at: "2026-08-18T07:00:00.000Z",
  retrieved_at: "2026-08-19T06:00:00.000Z",
  topic: "finance" as const
};

function newsletterItem(bodyMd: string, sourceUrls: string[] = [FRANCE24.url]): GeneratedContentItem {
  return {
    content_type: "newsletter_article",
    slot: "newsletter",
    language: "fr",
    title: "Le taux directeur reste inchangé",
    topic: "finance",
    source_urls: sourceUrls,
    version: 1,
    summary: "Résumé.",
    why_it_matters: "Pourquoi c'est important.",
    published_date: "2026-08-18",
    body_md: bodyMd
  } as unknown as GeneratedContentItem;
}

function payloadWith(item: GeneratedContentItem): DailyDropPayload {
  return {
    drop_date: "2026-08-19",
    language: "fr",
    prompt_version: "test",
    generator_version: "test",
    items: [item]
  };
}

function sanitizeBody(bodyMd: string, sourceUrls?: string[]): string {
  const sanitized = sanitizeLlmDailyDropPayload(
    payloadWith(newsletterItem(bodyMd, sourceUrls)),
    [FRANCE24]
  );

  return (sanitized.items[0] as { body_md: string }).body_md;
}

describe("invented source names cannot survive", () => {
  it("removes a Reuters/FT footer when only France24 was supplied", () => {
    const body = sanitizeBody(
      [
        "La banque centrale a maintenu son taux directeur.",
        "",
        "**So what ?** La trajectoire reste inchangée.",
        "",
        "Sources : Reuters (18 août 2026), Financial Times (18 août 2026)"
      ].join("\n")
    );

    // The decisive assertions.
    expect(body).not.toMatch(/Reuters/i);
    expect(body).not.toMatch(/Financial Times/i);
    expect(body).toContain("France24");
    expect(body).toContain(FRANCE24.url);
  });

  it.each([
    "Sources : Reuters (date), Financial Times (date)",
    "Sources: Reuters, FT",
    "**Sources :** Reuters (18 août 2026)",
    "source : Reuters"
  ])("strips the model footer written as %s", (footer) => {
    const body = sanitizeBody(`Corps de l'article.\n\n${footer}`);

    expect(body).not.toMatch(/Reuters/i);
    expect(body).toContain("France24");
  });

  it("keeps the article text itself", () => {
    const body = sanitizeBody(
      "La banque centrale a maintenu son taux.\n\n**So what ?** Rien ne change.\n\nSources : Reuters"
    );

    expect(body).toContain("La banque centrale a maintenu son taux.");
    expect(body).toContain("**So what ?** Rien ne change.");
  });

  it("adds the canonical footer even when the model wrote none", () => {
    const body = sanitizeBody("Un article sans pied de page.");

    expect(body).toContain(`Source: France24, published 2026-08-18, retrieved 2026-08-19. ${FRANCE24.url}`);
  });

  it("drops a source URL that was never supplied", () => {
    const sanitized = sanitizeLlmDailyDropPayload(
      payloadWith(
        newsletterItem("Corps.", [FRANCE24.url, "https://www.reuters.com/invented-article"])
      ),
      [FRANCE24]
    );
    const item = sanitized.items[0] as { body_md: string; source_urls: string[] };

    expect(item.source_urls).toEqual([FRANCE24.url]);
    expect(item.body_md).not.toMatch(/reuters\.com/i);
  });

  it("does not remove source_urls from the structured item", () => {
    const sanitized = sanitizeLlmDailyDropPayload(payloadWith(newsletterItem("Corps.")), [
      FRANCE24
    ]);

    expect((sanitized.items[0] as { source_urls: string[] }).source_urls).toEqual([FRANCE24.url]);
  });

  it("names every supplied source it actually used, once each", () => {
    const second = {
      ...FRANCE24,
      url: "https://www.lemonde.fr/economie/article-2",
      publisher: "Le Monde",
      published_at: null
    };
    const sanitized = sanitizeLlmDailyDropPayload(
      payloadWith(newsletterItem("Corps.\n\nSources : Reuters", [FRANCE24.url, second.url])),
      [FRANCE24, second]
    );
    const body = (sanitized.items[0] as { body_md: string }).body_md;

    expect(body).toContain("France24");
    expect(body).toContain("Le Monde");
    expect(body).not.toMatch(/Reuters/i);
    // A source with no publication date reports only what is known.
    expect(body).toContain("Source: Le Monde, retrieved 2026-08-19.");
    expect(body.match(/France24/g)).toHaveLength(1);
  });
});
