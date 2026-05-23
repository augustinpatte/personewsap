import { MINI_CASE_TOPIC_IDS, type MiniCaseTopicId } from "../domain.js";

export const MINI_CASE_SCENARIO_TYPES = [
  "acquisition_decision",
  "pricing_decision",
  "compliance_risk",
  "capital_allocation",
  "product_launch",
  "market_entry",
  "cost_optimization",
  "clinical_trial_decision",
  "supply_chain_constraint",
  "ai_build_vs_buy",
  "portfolio_risk",
  "contract_negotiation",
  "capacity_planning"
] as const;

export const MINI_CASE_DECISION_TYPES = [
  "choose_metric",
  "choose_strategy",
  "identify_risk",
  "rank_options",
  "reject_bad_assumption",
  "interpret_result",
  "allocate_budget",
  "choose_next_step"
] as const;

export const MINI_CASE_CONCEPTS = [
  "margin",
  "cash_flow",
  "valuation_multiple",
  "risk_adjusted_return",
  "regulatory_risk",
  "privacy_compliance",
  "opportunity_cost",
  "switching_cost",
  "bottleneck",
  "sensitivity_analysis",
  "market_liquidity",
  "trial_endpoint",
  "unit_economics"
] as const;

export const MINI_CASE_QUESTION_PATTERNS = [
  "framework_then_apply_then_decide",
  "diagnose_then_prioritize_then_recommend",
  "metric_then_tradeoff_then_next_step",
  "risk_then_evidence_then_decision",
  "reject_assumption_then_test_then_conclude"
] as const;

export const MINI_CASE_CORRECT_ANSWER_PATTERNS = [
  "best_next_signal",
  "least_risky_option",
  "highest_expected_value",
  "constraint_first",
  "evidence_before_action",
  "reject_overconfident_claim"
] as const;

export type MiniCaseScenarioType = (typeof MINI_CASE_SCENARIO_TYPES)[number];
export type MiniCaseDecisionType = (typeof MINI_CASE_DECISION_TYPES)[number];
export type MiniCaseConcept = (typeof MINI_CASE_CONCEPTS)[number];
export type MiniCaseQuestionPattern = (typeof MINI_CASE_QUESTION_PATTERNS)[number];
export type MiniCaseCorrectAnswerPattern = (typeof MINI_CASE_CORRECT_ANSWER_PATTERNS)[number];

export const MINI_CASE_ALLOWED_FRAMING: Record<MiniCaseTopicId, string> = {
  finance_economy: "Finance/economy education about budgets, cash flow, macro signals, and business decisions. No personalized financial advice.",
  stock_market: "Market education about risk, liquidity, valuation, and portfolio reasoning. No buy/sell instructions or personalized investment advice.",
  ai: "AI product and operations education about build-vs-buy, capacity, data, trust, and deployment trade-offs.",
  law_compliance: "Business compliance and legal-risk education. Explain rules, incentives, process, and risk controls; never give personal legal advice.",
  health_pharma: "Pharma, healthcare business, and public-health decision education. Discuss trials, endpoints, access, regulation, and operations; never diagnose or give treatment advice.",
  engineering_operations: "Engineering and operations education about reliability, capacity, bottlenecks, supply chains, and execution trade-offs."
};

export function isMiniCaseScenarioType(value: string): value is MiniCaseScenarioType {
  return MINI_CASE_SCENARIO_TYPES.includes(value as MiniCaseScenarioType);
}

export function isMiniCaseDecisionType(value: string): value is MiniCaseDecisionType {
  return MINI_CASE_DECISION_TYPES.includes(value as MiniCaseDecisionType);
}

export function isMiniCaseConcept(value: string): value is MiniCaseConcept {
  return MINI_CASE_CONCEPTS.includes(value as MiniCaseConcept);
}

export function isMiniCaseQuestionPattern(value: string): value is MiniCaseQuestionPattern {
  return MINI_CASE_QUESTION_PATTERNS.includes(value as MiniCaseQuestionPattern);
}

export function isMiniCaseCorrectAnswerPattern(value: string): value is MiniCaseCorrectAnswerPattern {
  return MINI_CASE_CORRECT_ANSWER_PATTERNS.includes(value as MiniCaseCorrectAnswerPattern);
}

export function isApprovedMiniCaseProductTopic(value: string): value is MiniCaseTopicId {
  return MINI_CASE_TOPIC_IDS.includes(value as MiniCaseTopicId);
}
