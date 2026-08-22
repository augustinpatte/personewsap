import type { RankedArticle } from "../domain.js";

/**
 * Whether a source packet can actually carry a Business Story.
 *
 * True and recent is not the same as enough. The launch catalog contains a story
 * built on an ISS antenna deployment that spends most of its length explaining
 * what the source does not say: no cost, no company, no contract, no margin, no
 * competitive mechanism, no commercial outcome. The grounding rules worked
 * exactly as designed — the story refused to invent any of it — and the result
 * is still an item nobody wants to read.
 *
 * Caution is not the problem. Choosing an event that cannot support a business
 * story is. When the evidence is this thin the answer is a better event, not a
 * story padded with disclaimers, and that decision belongs before generation
 * rather than in the prose.
 *
 * The gate looks for what a business story is made of: at least two different
 * mechanism families, or one mechanism plus a real figure. It reads the WHOLE
 * packet, so a thin announcement paired with an approved source that supplies
 * the economics passes on their combined strength — which is the point of
 * allowing supporting sources at all.
 */

export type BusinessStoryRichnessVerdict = "sufficient" | "insufficient" | "ambiguous";

export type BusinessStoryRichness = {
  /** Whether there was enough text to judge at all. */
  assessable: boolean;
  /**
   * The deterministic reading.
   *
   * `ambiguous` means the packet is too terse to judge — a title and a two-line
   * RSS summary. That used to count as a pass, on the reasoning that absence of
   * evidence is not evidence of absence. For Business Story selection that is
   * backwards, and it is how "Budget de rentrée : les abonnements sont visibles,
   * pas encore le mécanisme" got written: the missing information IS the story.
   *
   * The verdict is reported rather than resolved here. The caller decides, and
   * for Business Stories the default is to move on to another event.
   */
  verdict: BusinessStoryRichnessVerdict;
  sufficient: boolean;
  /** Which mechanism families the packet actually supports. */
  mechanisms: string[];
  /** A money amount, a percentage, or a counted quantity. */
  hasFigures: boolean;
};

/** Below this much prose the packet cannot be judged either way. */
const MIN_ASSESSABLE_CHARS = 200;

/**
 * The mechanism families named in the Business Story brief.
 *
 * Matched on vocabulary a business article uses when it is actually about the
 * mechanism, not on any word that could appear near it.
 */
const MECHANISM_FAMILIES: Array<{ name: string; pattern: RegExp }> = [
  { name: "pricing", pattern: /\b(pric|tarif|rate\s+card|discount|remise|markup|marge\s+commerciale)/i },
  { name: "unit_economics", pattern: /\b(unit\s+econom|margin|marge|profitab|rentab|contribution|ebitda|gross\s+profit|per[-\s]unit)/i },
  { name: "cost_structure", pattern: /\b(cost|co[uû]t|expense|d[ée]pense|overhead|opex|capex|amortis|subsid|subvention)/i },
  { name: "distribution", pattern: /\b(distribut|channel|canal|retail|d[ée]taillant|wholesal|grossiste|storefront|marketplace|franchis)/i },
  { name: "capacity", pattern: /\b(capacit|throughput|utilis|utiliz|backlog|bottleneck|goulot|output|production\s+line|usine|plant)/i },
  { name: "competition", pattern: /\b(competit|concurren|rival|market\s+share|part\s+de\s+march|entrant|incumbent)/i },
  { name: "switching_cost", pattern: /\b(switching\s+cost|lock[-\s]?in|migration|verrouillage|coût\s+de\s+changement)/i },
  { name: "regulation", pattern: /\b(regulat|réglement|reglement|antitrust|concurrence|licen[cs]e|permit|tariff|douane|sanction|complian)/i },
  { name: "capital_allocation", pattern: /\b(capital\s+allocat|buyback|rachat\s+d'actions|dividend|dividende|invest|acquisition|divest|c[ée]ssion|merger|fusion)/i },
  { name: "financing", pattern: /\b(financ|funding|lev[ée]e\s+de\s+fonds|raise[ds]?\s+\$|debt|dette|loan|prêt|bond|obligation|equity|valuation|valoris)/i },
  { name: "supply_chain", pattern: /\b(supply\s+chain|cha[îi]ne\s+d'approvisionnement|supplier|fournisseur|sourcing|inventory|stock|logistic|shipment|livraison)/i },
  { name: "customer_acquisition", pattern: /\b(customer\s+acquisition|acquisition\s+client|user\s+growth|subscriber|abonn[ée]|churn|r[ée]tention|retention|cohort)/i },
  { name: "operating_leverage", pattern: /\b(operating\s+leverage|levier\s+op[ée]rationnel|fixed\s+cost|co[uû]ts\s+fixes|scale\s+econom|économies\s+d'échelle)/i },
  { name: "market_structure", pattern: /\b(market\s+structure|consolidat|fragment|oligopol|monopol|barrier\s+to\s+entry|barri[èe]re\s+[àa]\s+l'entr[ée]e)/i },
  { name: "incentives", pattern: /\b(incentiv|incitation|compensation|r[ée]mun[ée]ration|bonus|commission|penalty|p[ée]nalit)/i },
  { name: "risk_allocation", pattern: /\b(risk\s+allocat|liabilit|responsabilit|indemnit|guarantee|garantie|insur|assuranc|warrant)/i },
  { name: "governance", pattern: /\b(governance|gouvernance|board|conseil\s+d'administration|shareholder|actionnaire|stake|control\s+of\s+the\s+company)/i },
  { name: "contract", pattern: /\b(contract|contrat|order\s+book|carnet\s+de\s+commandes|procurement|appel\s+d'offres|tender|deal\s+worth)/i }
];

/** A money amount, a percentage, or a counted business quantity. */
const FIGURE_PATTERN =
  /(\d[\d.,\s]*\s*%|[$€£]\s?\d|\d[\d.,\s]*\s?(million|milliard|billion|bn|m\b|k\b|md\b|euros?|dollars?)|\d[\d.,\s]*\s+(stores?|magasins?|units?|unit[ée]s?|customers?|clients?|employees?|salari[ée]s?|contracts?|contrats?))/i;

export function assessBusinessStorySourceRichness(input: {
  articles: readonly RankedArticle[];
}): BusinessStoryRichness {
  const text = input.articles
    .flatMap((article) => [article.title, article.summary ?? "", article.body ?? ""])
    .filter((value) => typeof value === "string" && value.length > 0)
    .join("\n");

  const assessable = text.trim().length >= MIN_ASSESSABLE_CHARS;
  const mechanisms = MECHANISM_FAMILIES.filter((family) => family.pattern.test(text)).map(
    (family) => family.name
  );
  const hasFigures = FIGURE_PATTERN.test(text);

  // Two independent mechanisms, or one mechanism the packet can put a number on.
  // Either gives a story a WHO, a WHAT CHANGED and a real trade-off; neither can
  // be satisfied by an announcement that says only that a thing happened.
  const carriesMechanism = mechanisms.length >= 2 || (mechanisms.length >= 1 && hasFigures);
  const verdict: BusinessStoryRichnessVerdict = carriesMechanism
    ? "sufficient"
    : assessable
      ? "insufficient"
      : "ambiguous";

  return {
    assessable,
    verdict,
    sufficient: verdict === "sufficient",
    mechanisms,
    hasFigures
  };
}
