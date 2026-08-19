import { describe, expect, it } from "vitest";

import type { ArticleCandidate, TopicId } from "../domain.js";
import { categorizeArticle } from "./categorize.js";
import {
  applyRelevanceVerdicts,
  buildRelevanceClassificationPrompt,
  evaluateTopicRelevance,
  runDeterministicRelevanceGate,
  toRelevanceCandidate,
  TOPIC_DEFINITIONS
} from "./topicRelevance.js";

/**
 * The two real failures from the first live proof:
 *
 *  - a Franceinfo item about the murder of an influencer was published as
 *    tech_ai, because it arrived on a Tech/Web feed;
 *  - an F1 driver's injury became a "sport_business" story with no business
 *    mechanism anywhere in the source.
 *
 * Both came from the same assumption: that a feed's configured category proves
 * the category of every article inside it. These tests hold the new rule — the
 * feed is a hint, the text is the evidence.
 */

function article(input: {
  title: string;
  summary?: string;
  sourceTopic?: TopicId | null;
}): ArticleCandidate {
  return {
    url: `https://example.test/${encodeURIComponent(input.title)}`,
    title: input.title,
    publisher: "Test Publisher",
    author: null,
    published_at: "2026-08-19T08:00:00.000Z",
    retrieved_at: "2026-08-19T09:00:00.000Z",
    language: "fr",
    summary: input.summary ?? null,
    body: null,
    sourceTopic: input.sourceTopic ?? null
  } as ArticleCandidate;
}

describe("the feed category is a hint, not proof", () => {
  it("rejects the influencer murder story that a tech feed carried", () => {
    const decision = evaluateTopicRelevance(
      article({
        title: "Meurtre d'une influenceuse : un suspect interpellé",
        summary:
          "La jeune femme, suivie par des centaines de milliers d'abonnés, a été retrouvée morte à son domicile.",
        sourceTopic: "tech_ai"
      })
    );

    expect(decision.status).toBe("rejected");
    // Having an audience on a platform is not a technology story.
    expect(decision.status === "rejected" && decision.reason).toMatch(/off-topic/);
  });

  it("accepts a genuine model, chip or cloud story as tech_ai", () => {
    for (const [title, summary] of [
      [
        "Nvidia dévoile une nouvelle puce pour l'inférence",
        "Le semi-conducteur vise les centres de données et double la bande passante mémoire."
      ],
      [
        "OpenAI ouvre son modèle de langage aux entreprises",
        "Le modèle de langage est proposé via une offre cloud dédiée."
      ]
    ]) {
      const decision = evaluateTopicRelevance(
        article({ title, summary, sourceTopic: "tech_ai" })
      );

      expect(decision.status).toBe("accepted");
      expect(decision.status === "accepted" && decision.topic).toBe("tech_ai");
    }
  });

  it("cannot be forced by sourceTopic alone", () => {
    // Same feed hint, no corroborating text: never a confident acceptance.
    const decision = evaluateTopicRelevance(
      article({
        title: "Le festival du village attire les visiteurs",
        summary: "Trois jours de fête au centre du bourg.",
        sourceTopic: "tech_ai"
      })
    );

    expect(decision.status).not.toBe("accepted");
  });
});

describe("sport_business requires an industry mechanism", () => {
  it("rejects a normal F1 injury with no commercial angle", () => {
    const decision = evaluateTopicRelevance(
      article({
        title: "Grand Prix : le pilote blessé déclare forfait",
        summary: "Victime d'une blessure au poignet lors des qualifications, il manquera la course.",
        sourceTopic: "sport_business"
      })
    );

    expect(decision.status).toBe("rejected");
    expect(decision.status === "rejected" && decision.reason).toMatch(/business mechanism/);
  });

  it.each([
    ["La Ligue 1 renégocie ses droits TV", "Les droits de diffusion sont remis en jeu pour trois saisons."],
    ["Le club signe un partenariat commercial majeur", "Un sponsoring maillot de 40 millions par saison."],
    ["Rachat du club : la valorisation atteint un record", "Les actionnaires valident la valorisation proposée."]
  ])("accepts %s", (title, summary) => {
    const decision = evaluateTopicRelevance(
      article({ title, summary, sourceTopic: "sport_business" })
    );

    expect(decision.status).toBe("accepted");
    expect(decision.status === "accepted" && decision.topic).toBe("sport_business");
  });

  it("stays ambiguous rather than guessing when a sports feed carries neither", () => {
    const decision = evaluateTopicRelevance(
      article({
        title: "Le tournoi déménage dans une nouvelle ville",
        summary: "L'épreuve change de site à partir de la saison prochaine.",
        sourceTopic: "sport_business"
      })
    );

    // Not accepted, not confidently rejected: this is what the classifier is for.
    expect(decision.status).toBe("ambiguous");
  });
});

describe("categorizeArticle", () => {
  it("no longer returns sourceTopic unconditionally", () => {
    // The exact line that caused the bug: `if (article.sourceTopic) return it`.
    const murder = article({
      title: "Meurtre d'une influenceuse : un suspect interpellé",
      summary: "Enquête ouverte après la découverte du corps.",
      sourceTopic: "tech_ai"
    });

    const decision = evaluateTopicRelevance(murder);

    expect(decision.status).toBe("rejected");
    // Ranking still needs a topic, but publication is gated separately.
    expect(typeof categorizeArticle(murder)).toBe("string");
  });

  it("prefers a corroborated hint", () => {
    expect(
      categorizeArticle(
        article({
          title: "Le régulateur ouvre une enquête antitrust",
          summary: "Le tribunal examinera la plainte déposée par les concurrents.",
          sourceTopic: "law"
        })
      )
    ).toBe("law");
  });
});

describe("the classification batch", () => {
  it("sends titles and short excerpts, never article bodies", () => {
    const candidate = toRelevanceCandidate(
      article({
        title: "Un titre",
        summary: "x".repeat(1_000),
        sourceTopic: "business"
      })
    );

    expect(candidate.summary?.length).toBeLessThanOrEqual(320);
  });

  it("tells the classifier that the feed hint is not evidence", () => {
    const prompt = buildRelevanceClassificationPrompt([
      toRelevanceCandidate(article({ title: "A", sourceTopic: "tech_ai" }))
    ]);

    expect(prompt).toMatch(/feed_hint is only where the article was found/);
    expect(prompt).toMatch(/It is not evidence/);
    expect(prompt).toContain(TOPIC_DEFINITIONS.sport_business.slice(0, 40));
    // Structured, compact output.
    expect(prompt).toMatch(/"verdicts"/);
    expect(prompt).toMatch(/at most 12 words/);
  });

  it("batches every ambiguous candidate into one call", () => {
    const gate = runDeterministicRelevanceGate([
      article({ title: "Le tournoi déménage", sourceTopic: "sport_business" }),
      article({ title: "Une exposition ouvre ses portes", sourceTopic: "culture_media" })
    ]);

    expect(gate.ambiguous).toHaveLength(2);
    const prompt = buildRelevanceClassificationPrompt(
      gate.ambiguous.map(toRelevanceCandidate)
    );
    expect(prompt.split("---")).toHaveLength(2);
  });
});

describe("classifier verdicts", () => {
  const candidates = [
    toRelevanceCandidate(article({ title: "A" })),
    toRelevanceCandidate(article({ title: "B" }))
  ];

  it("honours a confident, well-formed acceptance", () => {
    const decisions = applyRelevanceVerdicts(candidates, [
      {
        article_id: candidates[0].id,
        accepted: true,
        topic: "finance",
        confidence: 0.94,
        reason: "central bank rate decision"
      }
    ]);

    expect(decisions.get(candidates[0].id)).toMatchObject({
      status: "accepted",
      topic: "finance"
    });
    // No verdict is a rejection, not a silent pass.
    expect(decisions.get(candidates[1].id)?.status).toBe("rejected");
  });

  it.each([
    ["an explicit reject", { accepted: false, topic: "reject" as const, confidence: 0.99 }],
    ["an unknown topic", { accepted: true, topic: "sports" as never, confidence: 0.99 }],
    ["low confidence", { accepted: true, topic: "finance" as const, confidence: 0.2 }]
  ])("rejects on %s", (_name, verdict) => {
    const decisions = applyRelevanceVerdicts(candidates, [
      { article_id: candidates[0].id, reason: "", ...verdict }
    ]);

    expect(decisions.get(candidates[0].id)?.status).toBe("rejected");
  });
});

describe("the gate splits a batch three ways", () => {
  it("separates accepted, rejected and ambiguous", () => {
    const gate = runDeterministicRelevanceGate([
      article({
        title: "Nvidia dévoile une puce",
        summary: "Le semi-conducteur double la bande passante.",
        sourceTopic: "tech_ai"
      }),
      article({
        title: "Meurtre d'une influenceuse",
        summary: "Un suspect interpellé.",
        sourceTopic: "tech_ai"
      }),
      article({ title: "Le tournoi déménage", sourceTopic: "sport_business" })
    ]);

    expect(gate.accepted).toHaveLength(1);
    expect(gate.rejected).toHaveLength(1);
    expect(gate.ambiguous).toHaveLength(1);
  });
});

describe("ranking keeps an ambiguous article in its own topic", () => {
  it("does not move a legitimate finance item out of finance", () => {
    // The probe caught this: an ambiguous item was re-scored into another
    // topic, which emptied the finance pool and made the section refuse to
    // generate at all.
    const item = article({
      title: "Le ministre présente le budget de l'État",
      summary: "Les arbitrages seront présentés au Parlement à l'automne.",
      sourceTopic: "finance"
    });

    expect(evaluateTopicRelevance(item).status).toBe("ambiguous");
    expect(categorizeArticle(item)).toBe("finance");
  });

  it("still moves an article when the text points strictly elsewhere", () => {
    expect(
      categorizeArticle(
        article({
          title: "Essai clinique : le médicament réduit la mortalité",
          summary: "L'hôpital publie les résultats de l'essai clinique sur les patients traités.",
          sourceTopic: "business"
        })
      )
    ).toBe("medicine");
  });
});

describe("keyword matching is word-aware", () => {
  it('does not let "ai" match inside ordinary French words', () => {
    // The latent bug the live probe exposed: a naive substring match made
    // "français", "faire" and "aide" score for tech_ai, so almost any French
    // article was pulled into technology.
    const item = article({
      title: "Le plan national de relance et de résilience",
      summary: "Le ministre fait le point sur l'aide aux collectivités françaises.",
      sourceTopic: "finance"
    });

    expect(categorizeArticle(item)).toBe("finance");
  });

  it("still matches a real occurrence of the word", () => {
    expect(
      categorizeArticle(
        article({
          title: "Cloud and data infrastructure spending rises",
          summary: "Cloud providers expand data centre capacity.",
          sourceTopic: null
        })
      )
    ).toBe("tech_ai");
  });
});
