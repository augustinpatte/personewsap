-- Persistent editorial memory for mini-case anti-repetition.
-- Service role only: no anon/authenticated policies are added.

CREATE TABLE IF NOT EXISTS public.mini_case_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id UUID REFERENCES public.content_items(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  topic TEXT NOT NULL,
  scenario_type TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  concept_tested TEXT NOT NULL,
  mechanism TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  question_pattern TEXT NOT NULL,
  correct_answer_pattern TEXT NOT NULL,
  core_takeaway TEXT NOT NULL,
  published_date DATE NOT NULL,
  language TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mini_case_history_slug_not_blank CHECK (length(trim(slug)) > 0),
  CONSTRAINT mini_case_history_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT mini_case_history_language_check CHECK (language IN ('fr', 'en')),
  CONSTRAINT mini_case_history_topic_check CHECK (
    topic IN ('finance_economy', 'stock_market', 'ai', 'law_compliance', 'health_pharma', 'engineering_operations')
  ),
  CONSTRAINT mini_case_history_scenario_type_check CHECK (
    scenario_type IN (
      'acquisition_decision',
      'pricing_decision',
      'compliance_risk',
      'capital_allocation',
      'product_launch',
      'market_entry',
      'cost_optimization',
      'clinical_trial_decision',
      'supply_chain_constraint',
      'ai_build_vs_buy',
      'portfolio_risk',
      'contract_negotiation',
      'capacity_planning'
    )
  ),
  CONSTRAINT mini_case_history_decision_type_check CHECK (
    decision_type IN (
      'choose_metric',
      'choose_strategy',
      'identify_risk',
      'rank_options',
      'reject_bad_assumption',
      'interpret_result',
      'allocate_budget',
      'choose_next_step'
    )
  ),
  CONSTRAINT mini_case_history_concept_tested_check CHECK (
    concept_tested IN (
      'margin',
      'cash_flow',
      'valuation_multiple',
      'risk_adjusted_return',
      'regulatory_risk',
      'privacy_compliance',
      'opportunity_cost',
      'switching_cost',
      'bottleneck',
      'sensitivity_analysis',
      'market_liquidity',
      'trial_endpoint',
      'unit_economics'
    )
  ),
  CONSTRAINT mini_case_history_question_pattern_check CHECK (
    question_pattern IN (
      'framework_then_apply_then_decide',
      'diagnose_then_prioritize_then_recommend',
      'metric_then_tradeoff_then_next_step',
      'risk_then_evidence_then_decision',
      'reject_assumption_then_test_then_conclude'
    )
  ),
  CONSTRAINT mini_case_history_correct_answer_pattern_check CHECK (
    correct_answer_pattern IN (
      'best_next_signal',
      'least_risky_option',
      'highest_expected_value',
      'constraint_first',
      'evidence_before_action',
      'reject_overconfident_claim'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS mini_case_history_slug_unique
ON public.mini_case_history(slug);

CREATE UNIQUE INDEX IF NOT EXISTS mini_case_history_content_item_unique
ON public.mini_case_history(content_item_id)
WHERE content_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mini_case_history_language_date
ON public.mini_case_history(language, published_date DESC);

CREATE INDEX IF NOT EXISTS idx_mini_case_history_topic_date
ON public.mini_case_history(topic, published_date DESC);

ALTER TABLE public.mini_case_history ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.mini_case_history IS
  'Service-role editorial memory used by content-engine to avoid repeated mini-case scenarios, concepts, decisions, question patterns, and titles.';
