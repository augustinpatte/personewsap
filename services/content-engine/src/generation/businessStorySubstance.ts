import type { BusinessStory } from "../domain.js";

/**
 * A Business Story must not be an article about why there is no story.
 *
 * The repair produced four candidates that passed every validator and were
 * unpublishable on sight:
 *
 *   "Brouillon non publiable : le mécanisme économique reste à documenter"
 *   "CVAE : une échéance réelle, mais pas encore une histoire d'entreprise démontrée"
 *   "Données fiscales compromises : le coût économique reste à documenter"
 *   "Budget de rentrée : les abonnements sont visibles, pas encore le mécanisme"
 *
 * The prompt taught the model not to invent, and the model obeyed. What nothing
 * checked was the other half: when the source could not support a story, the
 * model wrote the refusal AS the story. `businessStoryRichness` looks at the
 * source packet going in; nothing looked at what came out.
 *
 * This is that check. It is not a phrase blocklist — a model paraphrases its way
 * around one in a single retry. It asks a structural question instead:
 *
 *  - Does the story name a MECHANISM, or does it name the absence of one?
 *  - Do the title and the conclusion state a finding, or state that no finding
 *    could be reached?
 *
 * Hedging inside the narrative stays allowed. "The margin effect will not be
 * visible before the next quarter" is a real business statement about the
 * future. What is refused is a story whose own conclusion is that it has
 * nothing to conclude.
 */

export type BusinessStorySubstanceIssue = {
  field: string;
  code: "business_story_self_refuting" | "business_story_mechanism_absent";
  message: string;
  evidence: string;
};

/**
 * Markers that can only be the writer talking about their own draft.
 *
 * Refused wherever they appear, body included: no legitimate Business Story
 * describes itself as a draft or as unpublishable.
 */
const EDITORIAL_SELF_REFERENCE = [
  /brouillon/i,
  /non\s+publiable/i,
  /unpublishable/i,
  /\bdraft\b(?!\s+(law|bill|regulation|directive|order|guidance|rule))/i,
  /à\s+valider\s*[—:-]/i,
  /preuves?\s+insuffisantes?/i,
  /insufficient\s+evidence/i,
  /(ne\s+permet\s+pas|ne\s+permettent\s+pas)\s+d[eu']?[^.]{0,40}(histoire|récit|business\s+story)/i,
  /(cannot|does\s+not)\s+support\s+a\s+business\s+story/i,
  /pas\s+(encore\s+)?une\s+(vraie\s+)?(histoire|business\s+story)/i,
  /not\s+yet\s+a\s+business\s+story/i,
  /(mérite|justifie)\s+(donc\s+)?une\s+veille,?\s+pas\s+un\s+récit/i,
  /(requires|needs)\s+(another|a\s+second)\s+source/i,
  /une\s+autre\s+source\s+(est\s+)?(nécessaire|requise)/i
];

/**
 * "The thing this story exists to explain" paired with "we do not have it".
 *
 * Applied only to the fields that carry the story's finding — title, lesson,
 * decision, outcome, takeaway, mechanism. A story is allowed to say the market
 * has not reacted yet; it is not allowed to CONCLUDE that its own mechanism is
 * undocumented.
 */
const EVIDENCE_OBJECT =
  /(mécanisme|mecanisme|mechanism|co[uû]t\s+[ée]conomique|impact\s+[ée]conomique|effet\s+commercial|economic\s+(impact|cost|effect)|commercial\s+(effect|outcome)|histoire\s+(business|d'entreprise)|business\s+story|r[ée]cit\s+[ée]conomique|contrat|contract|mod[èe]le\s+[ée]conomique|business\s+model)/i;

const ABSENCE_PREDICATE =
  /(reste[nt]?\s+à\s+(documenter|[ée]tablir|d[ée]montrer)|non\s+document[ée]|pas\s+document[ée]|à\s+documenter|n'est\s+pas\s+(encore\s+)?(établi|etabli|démontré|demontre|document[ée])|ne\s+sont\s+pas\s+(encore\s+)?(établis|etablis|document[ée]s)|pas\s+encore\s+(le|la|de|d'|une|un)\b|inconnu|indéterminé|undocumented|not\s+(yet\s+)?(established|documented|demonstrated)|cannot\s+be\s+established|remains?\s+to\s+be\s+documented|unknown|insuffisant)/i;

/** A declared mechanism that is really the absence of a mechanism. */
const MECHANISM_ABSENCE =
  /^(.*\b)?(non\s+document|pas\s+document|à\s+documenter|inconnu|ind[ée]termin|undocumented|unknown|not\s+documented|insuffisan|absent|aucun|none|n\/a|tbd)/i;

export function validateBusinessStorySubstance(item: BusinessStory): BusinessStorySubstanceIssue[] {
  const issues: BusinessStorySubstanceIssue[] = [];

  // 1. The declared mechanism must be a mechanism.
  const mechanism = typeof item.editorial_memory?.key_mechanism === "string"
    ? item.editorial_memory.key_mechanism.trim()
    : "";

  if (mechanism.length > 0 && MECHANISM_ABSENCE.test(mechanism)) {
    issues.push({
      field: "editorial_memory.key_mechanism",
      code: "business_story_mechanism_absent",
      message: `key_mechanism is "${mechanism}", which names the absence of a mechanism rather than one. A Business Story is the explanation of a mechanism; if the source does not carry one, the event is wrong for this format and a different event must be chosen.`,
      evidence: mechanism
    });
  }

  // 2. Nothing anywhere may describe the item as a draft or as unpublishable.
  const everything = [
    item.title,
    item.setup,
    item.tension,
    item.decision,
    item.outcome,
    item.lesson,
    item.body_md,
    item.editorial_memory?.core_takeaway ?? "",
    item.editorial_memory?.strategic_angle ?? ""
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");

  for (const pattern of EDITORIAL_SELF_REFERENCE) {
    const match = everything.match(pattern);

    if (match) {
      issues.push({
        field: "body_md",
        code: "business_story_self_refuting",
        message: `The story describes itself as incomplete ("${match[0].trim()}"). A source-quality refusal must not be published as the story. Choose an event the sources can actually support.`,
        evidence: match[0].trim()
      });
      break;
    }
  }

  // 3. The finding fields must state a finding.
  const conclusionFields: Array<[string, string | undefined]> = [
    ["title", item.title],
    ["lesson", item.lesson],
    ["decision", item.decision],
    ["outcome", item.outcome],
    ["editorial_memory.core_takeaway", item.editorial_memory?.core_takeaway]
  ];

  for (const [field, value] of conclusionFields) {
    if (typeof value !== "string" || value.trim().length === 0) {
      continue;
    }

    for (const sentence of splitSentences(value)) {
      if (EVIDENCE_OBJECT.test(sentence) && ABSENCE_PREDICATE.test(sentence)) {
        issues.push({
          field,
          code: "business_story_self_refuting",
          message: `${field} concludes that the story's own subject is undocumented ("${sentence.trim()}"). Hedging inside the narrative is fine; a conclusion that nothing can be concluded is not a Business Story.`,
          evidence: sentence.trim()
        });
        break;
      }
    }
  }

  return issues;
}

/**
 * Sentence split for the co-occurrence rule.
 *
 * Colons count as breaks: a title like "Brouillon non publiable : le mécanisme
 * reste à documenter" is two clauses, and both halves have to be looked at on
 * their own before the pairing means anything.
 */
function splitSentences(value: string): string[] {
  return value
    .split(/[.!?;\n]+|\s[:—–-]\s/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
