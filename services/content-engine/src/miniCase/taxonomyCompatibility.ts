import type { MiniCaseTopicId } from "../domain.js";

/**
 * Taxonomy that is structurally valid but semantically absurd.
 *
 * The enum validators only ask whether a value is spelled correctly, so the
 * launch catalog shipped an AI-operations case filed as a
 * `clinical_trial_decision` testing a `trial_endpoint`, and a warehouse-robot
 * case filed as `privacy_compliance`. Both passed every check and both are
 * nonsense — and both poison what depends on the taxonomy downstream: editorial
 * memory rotation, the cooldown that stops a concept repeating, and the Learning
 * Path that groups cases by what they teach.
 *
 * This is deliberately NOT an ontology. Only a handful of taxonomy values are
 * domain-bound — they name a mechanism that belongs to one field — and each of
 * those carries a home topic list plus the vocabulary that would have to appear
 * in the case for it to be legitimate elsewhere.
 *
 * That second half matters. A genuine AI case about trial endpoints exists: it
 * is an AI case about drug trials, and it will talk about trials, cohorts and
 * endpoints. What the catalog produced instead was a cyber-operations case whose
 * text contains none of that, which is exactly what this refuses.
 *
 * Everything not listed here stays free. `margin`, `unit_economics`,
 * `opportunity_cost` and the rest are general business mechanisms and belong
 * wherever the case earns them.
 */

export type MiniCaseTaxonomyIssue = {
  field: "scenario_type" | "concept_tested";
  value: string;
  productTopic: MiniCaseTopicId;
  message: string;
};

type DomainBoundValue = {
  /** Topics where this value needs no further justification. */
  homeTopics: MiniCaseTopicId[];
  /** Vocabulary that shows the case really does contain this mechanism. */
  evidence: RegExp;
  /** What the value actually claims, for the retry message. */
  claim: string;
};

const DOMAIN_BOUND_SCENARIOS: Record<string, DomainBoundValue> = {
  clinical_trial_decision: {
    homeTopics: ["health_pharma"],
    evidence:
      /\b(clinical|trial|trials|essai|essais|cohort|cohorte|patient|patients|placebo|endpoint|phase\s*(i{1,3}|[123])|efficacy|efficacit)/i,
    claim: "a decision taken inside a clinical trial"
  },
  compliance_risk: {
    homeTopics: ["law_compliance", "health_pharma", "finance_economy"],
    evidence:
      /\b(complian|regulat|réglement|reglement|legal|juridique|law|loi|directive|authority|autorit|supervis|sanction|fine|amende|audit|licen[cs]e|gdpr|rgpd)/i,
    claim: "a compliance or regulatory-risk decision"
  }
};

const DOMAIN_BOUND_CONCEPTS: Record<string, DomainBoundValue> = {
  trial_endpoint: {
    homeTopics: ["health_pharma"],
    evidence:
      /\b(clinical|trial|trials|essai|essais|cohort|cohorte|patient|patients|placebo|endpoint|critère\s+d|primary\s+outcome|efficacy|efficacit)/i,
    claim: "the endpoint a clinical trial is measured against"
  },
  privacy_compliance: {
    homeTopics: ["ai", "law_compliance", "health_pharma"],
    evidence:
      /\b(privacy|priv[ée]e|personal\s+data|données\s+personnelles|donnees\s+personnelles|gdpr|rgpd|consent|consentement|anonymi|pseudonymi|surveillance|biometric|biom[ée]tri)/i,
    claim: "a personal-data or privacy obligation"
  },
  regulatory_risk: {
    homeTopics: ["law_compliance", "health_pharma", "finance_economy"],
    evidence:
      /\b(regulat|réglement|reglement|complian|authority|autorit|supervis|licen[cs]e|permit|sanction|antitrust|concurrence|directive|statute|loi|legal|juridique)/i,
    claim: "a rule set by a regulator"
  }
};

/**
 * Check a mini case's taxonomy against what its own text actually contains.
 *
 * `caseText` should be everything the reader sees: context, challenge,
 * questions, options, takeaway. The mechanism has to be visible somewhere in the
 * case, not merely asserted in a metadata field.
 */
export function validateMiniCaseTaxonomyCompatibility(input: {
  productTopic: MiniCaseTopicId;
  scenarioType: string | null | undefined;
  conceptTested: string | null | undefined;
  caseText: string;
}): MiniCaseTaxonomyIssue[] {
  const issues: MiniCaseTaxonomyIssue[] = [];

  const check = (
    field: MiniCaseTaxonomyIssue["field"],
    value: string | null | undefined,
    table: Record<string, DomainBoundValue>
  ): void => {
    if (typeof value !== "string") {
      return;
    }

    const bound = table[value];

    if (!bound || bound.homeTopics.includes(input.productTopic)) {
      return;
    }

    if (bound.evidence.test(input.caseText)) {
      // Cross-domain, but the case genuinely contains the mechanism. A pharma
      // case filed under AI is a real case, and it stays allowed.
      return;
    }

    issues.push({
      field,
      value,
      productTopic: input.productTopic,
      message: `${field} "${value}" claims ${bound.claim}, which a ${input.productTopic} case only qualifies for when the case itself contains that mechanism — and this one never mentions it. Choose taxonomy that describes the decision this case actually asks the reader to make.`
    });
  };

  check("scenario_type", input.scenarioType, DOMAIN_BOUND_SCENARIOS);
  check("concept_tested", input.conceptTested, DOMAIN_BOUND_CONCEPTS);

  return issues;
}

/** The reader-visible text of a case, as one string. */
export function miniCaseSemanticText(item: {
  title?: unknown;
  context?: unknown;
  challenge?: unknown;
  question?: unknown;
  mechanism?: unknown;
  core_takeaway?: unknown;
  final_takeaway?: unknown;
  body_md?: unknown;
  expected_reasoning?: unknown;
  questions?: unknown;
}): string {
  const parts: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value === "string") {
      parts.push(value);
    }
  };

  push(item.title);
  push(item.context);
  push(item.challenge);
  push(item.question);
  push(item.mechanism);
  push(item.core_takeaway);
  push(item.final_takeaway);
  push(item.body_md);

  if (Array.isArray(item.expected_reasoning)) {
    item.expected_reasoning.forEach(push);
  }

  if (Array.isArray(item.questions)) {
    for (const question of item.questions) {
      if (!question || typeof question !== "object") {
        continue;
      }

      const typed = question as { question?: unknown; options?: unknown };
      push(typed.question);

      if (Array.isArray(typed.options)) {
        for (const option of typed.options) {
          if (option && typeof option === "object") {
            const typedOption = option as { text?: unknown; feedback?: unknown };
            push(typedOption.text);
            push(typedOption.feedback);
          }
        }
      }
    }
  }

  return parts.join("\n");
}
