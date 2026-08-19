import { TOPIC_IDS, type ArticleCandidate, type TopicId } from "../domain.js";
import { containsKeyword } from "./categorize.js";

/**
 * Whether an article genuinely belongs to the editorial topic it was fetched
 * under.
 *
 * The live proof produced two failures that both trace to the same wrong
 * assumption — that a feed's configured category proves the category of every
 * item inside it:
 *
 *  - a Franceinfo item about the murder of an influencer was filed as tech_ai,
 *    because it arrived on a Tech/Web feed;
 *  - an F1 driver's injury became a "sport_business" story, although the source
 *    contained no business mechanism at all.
 *
 * A feed's category is a prior about what it *usually* publishes. It is not
 * evidence about the article in hand. So `sourceTopic` is treated here as a
 * hint that still has to be corroborated by the title, summary and any
 * available text.
 *
 * The gate is deliberately two-stage. Most articles are decided deterministically
 * and for free; only the genuinely ambiguous remainder is worth spending a
 * cheap model call on (see buildRelevanceClassificationPrompt).
 *
 * Everything here is pure so the editorial rules can be tested as rules.
 */

export type RelevanceDecision =
  /** Corroborated: publish under `topic`. */
  | { status: "accepted"; topic: TopicId; confidence: number; reason: string }
  /** Actively wrong for every product topic: never publish it. */
  | { status: "rejected"; reason: string }
  /** Needs the classifier: deterministic signals are inconclusive. */
  | { status: "ambiguous"; hint: TopicId | null; reason: string };

/**
 * What each topic is actually about. These are the definitions the classifier
 * is given, and the ones the deterministic rules encode; keeping one source of
 * truth is what stops the prompt and the code from drifting apart.
 */
export const TOPIC_DEFINITIONS: Record<TopicId, string> = {
  business:
    "company strategy, pricing, margins, competition, M&A, operations, business models, revenue, management",
  finance:
    "rates, inflation, banking, credit, securities, markets, funding, monetary policy, liquidity, corporate or public finance",
  tech_ai:
    "AI, software, cloud, chips, cybersecurity, models, infrastructure, platform technology, computing, data. NOT tech merely because someone used social media, a crime involved the internet, or something happened on a website",
  law: "legal, regulatory, compliance, judicial or governance developments",
  medicine:
    "medicine, public health, clinical research, pharma, hospitals, biomedical science, health regulation",
  engineering:
    "engineering systems, manufacturing, infrastructure, energy, aerospace, robotics, technical operations",
  sport_business:
    "sport as an industry: media rights, sponsorship, ticketing, valuation, ownership, league economics, club finances, athlete commercial contracts, governance, commercial partnerships, audience or revenue economics. A score, injury, transfer rumour or race result alone is NOT sport_business",
  culture_media:
    "media economics, streaming, cinema business, music industry, creator economy, publishing, rights, audiences, cultural institutions, platform or media strategy. Generic cultural news with no industry angle does NOT qualify"
};

/**
 * Terms that establish a topic on their own. Presence is strong evidence, and
 * for the two topics that were mis-assigned in the proof it is *required*.
 */
const TOPIC_EVIDENCE: Record<TopicId, string[]> = {
  business: [
    "acquisition",
    "merger",
    "revenue",
    "margin",
    "pricing",
    "market share",
    "business model",
    "chiffre d'affaires",
    "rachat",
    "fusion",
    "marge",
    "stratégie",
    "restructuration"
  ],
  finance: [
    "interest rate",
    "inflation",
    "central bank",
    "bond",
    "equity",
    "ipo",
    "funding round",
    "monetary policy",
    "taux",
    "inflation",
    "banque centrale",
    "obligation",
    "bourse",
    "levée de fonds"
  ],
  tech_ai: [
    "artificial intelligence",
    "machine learning",
    "language model",
    "algorithm",
    "semiconductor",
    "chip",
    "cloud",
    "data center",
    "cybersecurity",
    "software",
    "open source",
    "intelligence artificielle",
    "modèle de langage",
    "puce",
    "semi-conducteur",
    "cloud",
    "cybersécurité",
    "logiciel",
    "centre de données"
  ],
  law: [
    "court",
    "lawsuit",
    "regulator",
    "antitrust",
    "compliance",
    "ruling",
    "legislation",
    "tribunal",
    "justice",
    "régulateur",
    "loi",
    "plainte",
    "condamnation",
    "réglementation"
  ],
  medicine: [
    "clinical trial",
    "patient",
    "drug",
    "vaccine",
    "hospital",
    "fda",
    "ema",
    "therapy",
    "essai clinique",
    "médicament",
    "vaccin",
    "hôpital",
    "santé publique",
    "thérapie"
  ],
  engineering: [
    "manufacturing",
    "factory",
    "grid",
    "reactor",
    "aerospace",
    "robotics",
    "battery",
    "infrastructure",
    "usine",
    "réseau électrique",
    "réacteur",
    "aérospatial",
    "robotique",
    "batterie"
  ],
  // Required, not merely indicative: this is the list that separates a match
  // report from a sports-industry story.
  sport_business: [
    "media rights",
    "broadcast rights",
    "sponsorship",
    "sponsor",
    "ticketing",
    "valuation",
    "takeover",
    "ownership",
    "league revenue",
    "prize money",
    "salary cap",
    "transfer fee",
    "commercial partnership",
    "naming rights",
    "franchise",
    "club finances",
    "droits tv",
    "droits de diffusion",
    "sponsoring",
    "billetterie",
    "valorisation",
    "actionnaire",
    "rachat du club",
    "budget du club",
    "partenariat commercial",
    "masse salariale",
    "indemnité de transfert"
  ],
  culture_media: [
    "box office",
    "streaming",
    "subscribers",
    "audience",
    "royalties",
    "catalogue",
    "publishing",
    "advertising revenue",
    "creator economy",
    "audiences",
    "abonnés",
    "droits d'auteur",
    "maison d'édition",
    "recettes publicitaires",
    "salles de cinéma"
  ]
};

/**
 * Topics where the feed's category alone is never enough. Both were the actual
 * failures in the proof: an industry mechanism must appear in the text itself.
 */
const EVIDENCE_REQUIRED_TOPICS: TopicId[] = ["sport_business", "culture_media"];

/**
 * Subjects that disqualify an article outright, whatever feed carried it.
 * These are the shapes that reached the model in the proof: crime and human
 * interest stories arriving on a technology feed.
 */
const HARD_REJECT_MARKERS = [
  "meurtre",
  "assassinat",
  "féminicide",
  "homicide",
  "murder",
  "manhunt",
  "viol ",
  "rape",
  "pédocriminalité",
  "harcèlement scolaire",
  "faits divers",
  "horoscope",
  "météo du week-end",
  "recette de cuisine",
  "carnet rose",
  "nécrologie",
  "obituary"
];

/** Sport reporting with no industry angle: results, injuries, rumours. */
const SPORT_RESULT_MARKERS = [
  "blessure",
  "blessé",
  "forfait",
  "victoire",
  "défaite",
  "grand prix",
  "qualifications",
  "classement",
  "but de",
  "match nul",
  "injury",
  "injured",
  "wins",
  "beat",
  "defeat",
  "scored",
  "kick-off",
  "final score",
  "qualifying",
  "podium",
  "lap"
];

function haystack(article: ArticleCandidate): string {
  return `${article.title} ${article.summary ?? ""} ${article.body ?? ""}`.toLowerCase();
}

function hits(text: string, markers: readonly string[]): string[] {
  // Word-boundary matching, for the same reason as topicKeywordHits: a
  // fragment match would let ordinary prose satisfy an evidence requirement.
  return markers.filter((marker) => containsKeyword(text, marker));
}

/**
 * The deterministic stage.
 *
 * Answers only when it is confident, and says "ambiguous" otherwise rather than
 * guessing — a wrong confident answer here is exactly the bug being fixed.
 */
export function evaluateTopicRelevance(article: ArticleCandidate): RelevanceDecision {
  const text = haystack(article);
  const hint = article.sourceTopic ?? null;

  const rejected = hits(text, HARD_REJECT_MARKERS);

  if (rejected.length > 0) {
    return {
      status: "rejected",
      reason: `off-topic subject matter (${rejected[0]})`
    };
  }

  // Sport results are the single largest source of false sport_business
  // matches: reject them unless a commercial mechanism is also present.
  if (hint === "sport_business") {
    const evidence = hits(text, TOPIC_EVIDENCE.sport_business);
    const resultOnly = hits(text, SPORT_RESULT_MARKERS);

    if (evidence.length > 0) {
      return {
        status: "accepted",
        topic: "sport_business",
        confidence: 0.9,
        reason: `sports-industry mechanism present (${evidence[0]})`
      };
    }

    if (resultOnly.length > 0) {
      return {
        status: "rejected",
        reason: "sport result or injury with no business mechanism"
      };
    }
  }

  for (const topic of EVIDENCE_REQUIRED_TOPICS) {
    if (hint === topic && hits(text, TOPIC_EVIDENCE[topic]).length === 0) {
      return {
        status: "ambiguous",
        hint,
        reason: `${topic} requires an industry mechanism that the text does not show`
      };
    }
  }

  // A corroborated hint is the fast path: the feed said X and the text agrees.
  if (hint) {
    const evidence = hits(text, TOPIC_EVIDENCE[hint]);

    if (evidence.length > 0) {
      return {
        status: "accepted",
        topic: hint,
        confidence: 0.85,
        reason: `source topic corroborated by text (${evidence[0]})`
      };
    }
  }

  // No hint, or an uncorroborated one: does the text point strongly elsewhere?
  const scored = TOPIC_IDS.map((topic) => ({
    topic,
    score: hits(text, TOPIC_EVIDENCE[topic]).length
  }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 1 && scored[0].score >= 2) {
    return {
      status: "accepted",
      topic: scored[0].topic,
      confidence: 0.75,
      reason: `text evidence for ${scored[0].topic} only`
    };
  }

  return {
    status: "ambiguous",
    hint,
    reason: scored.length === 0 ? "no topic evidence in text" : "evidence spans several topics"
  };
}

export type RelevanceCandidate = {
  id: string;
  title: string;
  summary: string | null;
  sourceTopic: TopicId | null;
};

export type ClassifierVerdict = {
  article_id: string;
  accepted: boolean;
  topic: TopicId | "reject";
  confidence: number;
  reason: string;
};

/** Excerpt cap: title plus a compact summary is enough to judge relevance. */
const SUMMARY_EXCERPT_LIMIT = 320;

export function toRelevanceCandidate(article: ArticleCandidate): RelevanceCandidate {
  const summary = (article.summary ?? article.body ?? "").replace(/\s+/g, " ").trim();

  return {
    id: article.url,
    title: article.title.trim(),
    summary: summary ? summary.slice(0, SUMMARY_EXCERPT_LIMIT) : null,
    sourceTopic: article.sourceTopic ?? null
  };
}

/**
 * One batched classification call for every ambiguous candidate.
 *
 * Deliberately terse: the classifier decides relevance, it does not write
 * anything, so it is given titles and short excerpts rather than article
 * bodies. Batching keeps this to one request per run rather than one per
 * article.
 */
export function buildRelevanceClassificationPrompt(candidates: RelevanceCandidate[]): string {
  const definitions = TOPIC_IDS.map((topic) => `${topic}: ${TOPIC_DEFINITIONS[topic]}`).join("\n");
  const items = candidates
    .map((candidate) =>
      [
        `id: ${candidate.id}`,
        `feed_hint: ${candidate.sourceTopic ?? "none"}`,
        `title: ${candidate.title}`,
        candidate.summary ? `excerpt: ${candidate.summary}` : null
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n---\n");

  return [
    "Classify each article into one editorial topic, or reject it.",
    "feed_hint is only where the article was found. It is not evidence. Ignore it unless the title/excerpt supports it.",
    "Reject anything that does not genuinely belong to a topic below, including crime, human interest, and plain sport results.",
    "",
    "Topics:",
    definitions,
    "reject: belongs to none of the above",
    "",
    "Articles:",
    items,
    "",
    'Return JSON: {"verdicts":[{"article_id":"","accepted":true,"topic":"","confidence":0.0,"reason":""}]}',
    "reason: at most 12 words."
  ].join("\n");
}

/**
 * Fold classifier verdicts back onto the deterministic decisions.
 *
 * A verdict is only honoured when it is well-formed, names a real topic and is
 * reasonably confident. Anything else stays rejected: the product rule is that
 * no article is better than a misleading one, so an unusable answer must not
 * become an acceptance.
 */
export function applyRelevanceVerdicts(
  candidates: RelevanceCandidate[],
  verdicts: ClassifierVerdict[],
  minimumConfidence = 0.6
): Map<string, RelevanceDecision> {
  const byId = new Map(verdicts.map((verdict) => [verdict.article_id, verdict]));
  const decisions = new Map<string, RelevanceDecision>();

  for (const candidate of candidates) {
    const verdict = byId.get(candidate.id);

    if (!verdict) {
      decisions.set(candidate.id, {
        status: "rejected",
        reason: "classifier returned no verdict"
      });
      continue;
    }

    if (!verdict.accepted || verdict.topic === "reject") {
      decisions.set(candidate.id, {
        status: "rejected",
        reason: verdict.reason || "classifier rejected"
      });
      continue;
    }

    if (!isTopicId(verdict.topic)) {
      decisions.set(candidate.id, {
        status: "rejected",
        reason: `classifier returned unknown topic "${String(verdict.topic)}"`
      });
      continue;
    }

    if (!Number.isFinite(verdict.confidence) || verdict.confidence < minimumConfidence) {
      decisions.set(candidate.id, {
        status: "rejected",
        reason: `confidence ${verdict.confidence} below ${minimumConfidence}`
      });
      continue;
    }

    decisions.set(candidate.id, {
      status: "accepted",
      topic: verdict.topic,
      confidence: verdict.confidence,
      reason: verdict.reason || "classifier accepted"
    });
  }

  return decisions;
}

export function isTopicId(value: unknown): value is TopicId {
  return typeof value === "string" && (TOPIC_IDS as readonly string[]).includes(value);
}

export type RelevanceGateResult = {
  accepted: Array<{ article: ArticleCandidate; topic: TopicId; confidence: number; reason: string }>;
  rejected: Array<{ article: ArticleCandidate; reason: string }>;
  /** Candidates a classifier still has to judge. */
  ambiguous: ArticleCandidate[];
};

/** Runs the deterministic stage over a batch and splits it three ways. */
export function runDeterministicRelevanceGate(
  articles: ArticleCandidate[]
): RelevanceGateResult {
  const result: RelevanceGateResult = { accepted: [], rejected: [], ambiguous: [] };

  for (const article of articles) {
    const decision = evaluateTopicRelevance(article);

    if (decision.status === "accepted") {
      result.accepted.push({
        article,
        topic: decision.topic,
        confidence: decision.confidence,
        reason: decision.reason
      });
      continue;
    }

    if (decision.status === "rejected") {
      result.rejected.push({ article, reason: decision.reason });
      continue;
    }

    result.ambiguous.push(article);
  }

  return result;
}
