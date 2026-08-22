/**
 * Distractors a reader can dismiss without reading the case.
 *
 * The audit found options like "count news articles", "use the fund launch
 * date", "choose based on public visibility" and "choose whichever provider
 * makes the biggest promise". Each one is answerable by elimination: three
 * options are visibly unserious, so the fourth is the answer, and the reader
 * never reasons about the decision at all.
 *
 * The prompt now carries the full contract. This is the part of it a machine can
 * check, kept to signals strong enough to be worth a regeneration:
 *
 *  - a distractor drawn from a decision space nobody was in — media attention,
 *    company age, public visibility — when the case is about something else;
 *  - a correct answer that towers over its distractors, which is the length tell
 *    that lets a reader pick the "thorough-looking" option every time.
 *
 * What it deliberately does not try to judge is whether a plausible-sounding
 * wrong answer is wrong for a good reason. That is editorial, it belongs to the
 * prompt, and a regex pretending to measure it would only teach the model to
 * dodge the regex.
 */

export type DistractorIssue = {
  /** Index of the offending option, or -1 when the whole question is at fault. */
  optionIndex: number;
  code: "mini_case_distractor_offtopic" | "mini_case_correct_answer_too_dominant";
  message: string;
};

type OffTopicSignal = {
  name: string;
  /** Vocabulary that makes an option a non-decision. */
  pattern: RegExp;
  /** Vocabulary that would make it a real decision after all. */
  relevance: RegExp;
};

/**
 * Why the first version let these through, recorded so it is not repeated:
 *
 *   "packaging color"                            no family existed
 *   "brand age"                                  the family matched only "founding date"
 *   "number of countries where the brand is sold" no family existed
 *   "decide based on media coverage"             the family required "coverage count"
 *   "exact date the debt threshold was crossed"  no family existed
 *   "debt levels of other countries"             no family existed
 *
 * Every miss is the same miss: the guard was an allowlist of three narrowly
 * worded phrasings, so it could only catch what someone had already imagined.
 * The families below cover the observed classes and are widened where they were
 * too literal — but a string matcher cannot decide whether an unanticipated
 * option is a credible professional choice. That question belongs to the
 * semantic judge in `miniCaseEditorialJudge`; this stays the cheap first line.
 */
const OFF_TOPIC_SIGNALS: OffTopicSignal[] = [
  {
    name: "media attention",
    pattern:
      /\b(count(ing)?\s+(the\s+)?(news\s+)?articles|number\s+of\s+(news\s+)?articles|press\s+(mentions|clippings|coverage)|media\s+(buzz|hype|coverage|attention)|couverture\s+m[ée]diatique|nombre\s+d'articles|compter\s+les\s+articles|retomb[ée]es\s+presse)/i,
    relevance:
      /\b(reputation|r[ée]putation|brand|marque|communicat|public\s+relations|crisis|crise|boycott|sentiment|attention\s+[ée]conom)/i
  },
  {
    name: "company age",
    pattern:
      /\b((founding|foundation|incorporation)\s+date|date\s+de\s+(cr[ée]ation|fondation)|fund\s+launch\s+date|date\s+de\s+lancement\s+du\s+fonds|year\s+the\s+(company|brand|fund)\s+was\s+(founded|launched)|ann[ée]e\s+de\s+cr[ée]ation|(brand|company|fund)\s+age|(âge|age|anciennet[ée])\s+(de\s+la\s+marque|de\s+l'entreprise|du\s+fonds))/i,
    relevance:
      /\b(track\s+record|historique|anciennet[ée]|maturity|maturit[ée]|vintage|seniority|legacy\s+cost|amortis)/i
  },
  {
    name: "public visibility",
    pattern:
      /\b(public\s+visibility|visibilit[ée]\s+publique|how\s+well[-\s]known|notori[ée]t[ée]|name\s+recognition|popularity|popularit[ée]|biggest\s+promise|plus\s+grande\s+promesse|loudest|le\s+plus\s+connu)/i,
    relevance:
      /\b(brand|marque|market\s+share|part\s+de\s+march|customer\s+acquisition|acquisition\s+client|demand|demande|reputation|r[ée]putation)/i
  },
  {
    name: "cosmetic product attributes",
    pattern:
      /\b(packaging\s+(colou?r|design)|colou?r\s+of\s+the\s+(packaging|logo|label)|couleur\s+(de\s+l'emballage|du\s+logo)|logo\s+design|typeface|slogan|nom\s+de\s+la\s+marque|brand\s+name\s+alone)/i,
    // Phrases, not ambient words: a case that merely says "shelf price" is not
    // a case about packaging, and a one-word escape hatch is no hatch at all.
    relevance:
      /\b(packaging\s+(cost|redesign|change)|co[uû]t\s+d'emballage|rebrand|repositionn|shelf\s+space|lin[ée]aire|design\s+cost|regulatory\s+labell?ing|[ée]tiquetage)/i
  },
  {
    name: "geographic footprint count",
    pattern:
      /\b(number\s+of\s+(countries|markets|cities)|how\s+many\s+(countries|markets)|nombre\s+de\s+pays|nombre\s+de\s+march[ée]s|count(ing)?\s+the\s+(countries|markets))/i,
    relevance:
      /\b(market\s+entry|entr[ée]e\s+sur\s+le\s+march|expansion|international|distribution|logistic|supply\s+chain|regulatory\s+jurisdiction|juridiction)/i
  },
  {
    name: "an exact date as the decision criterion",
    pattern:
      /\b(exact\s+date|date\s+exacte|precise\s+date|the\s+exact\s+day|jour\s+exact)\b/i,
    relevance:
      /\b(deadline|[ée]ch[ée]ance|maturity|expiry|expiration|cut[-\s]?off|filing|d[ée]p[ôo]t|prescription|statute\s+of\s+limitation|d[ée]lai)/i
  },
  {
    name: "an unrelated third party's level",
    pattern:
      /\b((debt|revenue|margin|valuation|price)\s+levels?\s+of\s+other|(dette|revenus?|marges?)\s+d(es|'autres)\s+(pays|entreprises|soci[ée]t[ée]s)|other\s+(countries|companies)'?\s+(debt|revenue|margin))/i,
    // Same rule: "spread against the benchmark" is ambient market vocabulary,
    // not evidence that this case turns on what OTHER issuers owe.
    relevance:
      /\b(peer\s+(group|comparison|benchmark)|comparable\s+(compan|issuer|transaction)|relative\s+value|contagion|systemic|syst[ée]mique|cross[-\s]border\s+exposure)/i
  }
];

/**
 * How much longer the correct answer may be than its longest distractor before
 * length alone gives it away.
 */
const MAX_CORRECT_ANSWER_LENGTH_RATIO = 2;
/** Below this the ratio is noise: two short options differ by a few words. */
const MIN_CORRECT_ANSWER_LENGTH_GAP = 40;

export function validateMiniCaseDistractorQuality(
  options: ReadonlyArray<{ id: string; text: string; is_correct: boolean }>,
  caseText: string
): DistractorIssue[] {
  if (options.length < 2) {
    return [];
  }

  const issues: DistractorIssue[] = [];

  options.forEach((option, optionIndex) => {
    if (option.is_correct || typeof option.text !== "string") {
      return;
    }

    for (const signal of OFF_TOPIC_SIGNALS) {
      if (!signal.pattern.test(option.text)) {
        continue;
      }

      // Legitimate when the case really does turn on it: a crisis case can
      // genuinely be about media attention, and a fund case about vintage.
      if (signal.relevance.test(caseText)) {
        continue;
      }

      issues.push({
        optionIndex,
        code: "mini_case_distractor_offtopic",
        message: `Option "${truncate(option.text)}" is a ${signal.name} distractor in a case that is not about ${signal.name}. A reader dismisses it without reading, which turns the question into elimination. Replace it with a believable reasoning mistake inside the same decision space.`
      });
      break;
    }
  });

  const correct = options.find((option) => option.is_correct);
  const distractors = options.filter((option) => !option.is_correct);

  if (correct && distractors.length > 0) {
    const correctLength = textLength(correct.text);
    const longestDistractor = Math.max(...distractors.map((option) => textLength(option.text)));

    if (
      correctLength - longestDistractor >= MIN_CORRECT_ANSWER_LENGTH_GAP &&
      correctLength >= longestDistractor * MAX_CORRECT_ANSWER_LENGTH_RATIO
    ) {
      issues.push({
        optionIndex: -1,
        code: "mini_case_correct_answer_too_dominant",
        message: `The correct answer is ${correctLength} characters against ${longestDistractor} for the longest distractor. A reader picks the most thorough-looking option without reading the case. Give the four options comparable length and specificity.`
      });
    }
  }

  return issues;
}

function textLength(text: unknown): number {
  return typeof text === "string" ? text.trim().length : 0;
}

function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}
