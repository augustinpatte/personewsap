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

const OFF_TOPIC_SIGNALS: OffTopicSignal[] = [
  {
    name: "media attention",
    pattern:
      /\b(count(ing)?\s+(the\s+)?(news\s+)?articles|number\s+of\s+(news\s+)?articles|press\s+(mentions|clippings)|media\s+(buzz|hype|coverage\s+count)|nombre\s+d'articles|compter\s+les\s+articles|retomb[ée]es\s+presse)/i,
    relevance:
      /\b(reputation|r[ée]putation|brand|marque|communicat|public\s+relations|crisis|crise|boycott|sentiment|attention\s+[ée]conom)/i
  },
  {
    name: "company age",
    pattern:
      /\b((founding|foundation|incorporation)\s+date|date\s+de\s+(cr[ée]ation|fondation)|fund\s+launch\s+date|date\s+de\s+lancement\s+du\s+fonds|year\s+the\s+company\s+was\s+founded|ann[ée]e\s+de\s+cr[ée]ation)/i,
    relevance:
      /\b(track\s+record|historique|anciennet[ée]|maturity|maturit[ée]|vintage|seniority|legacy\s+cost|amortis)/i
  },
  {
    name: "public visibility",
    pattern:
      /\b(public\s+visibility|visibilit[ée]\s+publique|how\s+well[-\s]known|notori[ée]t[ée]|name\s+recognition|popularity|popularit[ée]|biggest\s+promise|plus\s+grande\s+promesse|loudest|le\s+plus\s+connu)/i,
    relevance:
      /\b(brand|marque|market\s+share|part\s+de\s+march|customer\s+acquisition|acquisition\s+client|demand|demande|reputation|r[ée]putation)/i
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
