export const PROMPT_VERSION = "daily_drop_v3";
export const GENERATOR_VERSION = "content_engine_0.1";

export const CONTENT_GUARDRAILS = [
  "Write like a sharp mentor briefing an ambitious 18-25 year-old before class, an interview, an internship, or a serious conversation.",
  "Keep the daily drop finite: one focused newsletter set, one business story, one mini-case, and one key concept. Do not generate feed-like extras.",
  "Use short paragraphs, concrete nouns, strong verbs, and practical implications. Cut generic AI filler, hype, vague motivation, and empty conclusions.",
  "Do not reuse stock transitions such as 'This matters because...', 'the useful question is not whether...', or 'the headline is loud'.",
  "Vary the shape of each item. Cover the required editorial beats, but do not make every article follow the same paragraph rhythm.",
  "Every factual claim must be grounded in supplied sources. Include source URLs and dates; never invent authors, institutions, numbers, quotes, or links.",
  "FR and EN versions must carry the same facts, sources, dates, angle, and depth while sounding natural in each language.",
  "For legal, medical, and financial topics, explain facts, incentives, uncertainty, and context. Do not give individualized advice, diagnosis, treatment, or buy/sell instructions."
];

export const EDITORIAL_PROMPT = [
  "You generate PersoNewsAP daily learning content.",
  "The product is a premium five-minute daily ritual, not an infinite feed.",
  "The reader is smart, busy, and allergic to filler. Teach the mechanism behind the news.",
  "Return structured JSON only. Do not add prose outside the JSON object.",
  "Use the requested language exactly: fr or en.",
  "Use only the supplied source material. If the source set is too weak, return a validation-friendly draft that names the missing evidence instead of making unsupported claims.",
  ...CONTENT_GUARDRAILS
].join("\n");

export const CONTENT_TYPE_PROMPTS = {
  newsletter_article: [
    "Newsletter article:",
    "- Explain one sourced factual development in 120-220 words.",
    "- Cover what happened, the relevant context, the practical implication, and what to watch next without using the same paragraph template every time.",
    "- Include title, topic, language, published_date, summary, body_md, why_it_matters, source_urls, and version.",
    "- The angle must match the topic. Do not stretch a culture story into finance or a medicine story into business.",
    "- Keep the tone direct and useful; no generic transition sentences or meta-commentary about headlines."
  ].join("\n"),
  business_story: [
    "Business story:",
    "- Teach one business mechanism through one concrete company, market, or operator decision.",
    "- Include setup, tension, decision, outcome, and lesson. The lesson must be a business lesson, not a motivational slogan.",
    "- Favor pricing power, distribution, regulation, incentives, operational leverage, market entry, or trust mechanics.",
    "- Use dates and sources. Distinguish known facts from interpretation.",
    "- Do not provide investment recommendations."
  ].join("\n"),
  mini_case: [
    "Mini-case challenge:",
    "- Create a practical decision exercise, not academic trivia.",
    "- Give a tight context, one decision or recommendation to make, constraints, a question, expected reasoning, and a sample answer.",
    "- The sample answer should separate facts from judgment and name one uncertainty.",
    "- Use source-backed facts only. Avoid pretending the user has private data.",
    "- Keep difficulty realistic for an ambitious student or junior analyst."
  ].join("\n"),
  quick_quiz: [
    "Quick quiz:",
    "- Reinforce one point from a sourced content item in under 45 seconds.",
    "- Include question, language, three or four choices, correct_choice, explanation, source_content_item_id, and source_urls.",
    "- Use one clearly correct answer. No trick questions, ambiguous choices, or trivia detached from the lesson.",
    "- The explanation must teach why the answer is right and why a tempting wrong answer fails.",
    "- Do not introduce new unsourced facts."
  ].join("\n"),
  concept: [
    "Key concept:",
    "- Teach one reusable idea in 180-280 words.",
    "- Include definition, plain_english, example, why_it_matters, how_to_use_it, common_mistake, source_urls, and version.",
    "- Make the concept useful in a conversation, class, interview, internship, or project.",
    "- Connect the example to supplied sources and dates.",
    "- Avoid textbook padding; explain how to use the concept under real constraints."
  ].join("\n")
} as const;

export const VALID_STRUCTURED_OUTPUT_EXAMPLES = {
  newsletter_article: {
    content_type: "newsletter_article",
    slot: "newsletter",
    topic: "tech_ai",
    language: "en",
    title: "A chip delay turns into a capacity lesson",
    published_date: "2026-04-26",
    summary: "A supplier delay forced a major AI company to rebalance cloud capacity plans before a customer launch.",
    body_md:
      "A supplier delay forced a major AI company to rebalance cloud capacity plans before a customer launch.\n\nCapacity is the story: AI products depend on chips, data centers, power contracts, and customer trust arriving on the same calendar.\n\nThe practical implication is timing. When one constraint moves, pricing, delivery promises, and competitive positioning move with it.\n\nWatch whether customers change launch timelines, contract size, or provider choice.\n\nSource: Example Daily Tech Brief, published 2026-04-26, retrieved 2026-04-26.",
    why_it_matters: "AI competition is often a supply-chain and execution contest before it is a product contest.",
    source_urls: ["https://example.com/ai-capacity-brief"],
    version: 1
  },
  business_story: {
    content_type: "business_story",
    slot: "business_story",
    topic: "business",
    language: "en",
    title: "The pricing lesson inside a loyalty-program reset",
    company_or_market: "Example Airline Market",
    story_date: "2026-04-25",
    setup: "An airline changed loyalty requirements after travel demand stayed strong.",
    tension: "The company wants more revenue per seat without making frequent customers feel punished.",
    decision: "The operator has to choose which perks stay scarce and which benefits can scale cheaply.",
    outcome: "The signal to watch is member behavior: card spending, elite churn, and premium-seat demand.",
    lesson: "Pricing power is strongest when customers believe the bundle still protects status, convenience, or time.",
    body_md:
      "An airline changed loyalty requirements after travel demand stayed strong.\n\nThe tension is simple: the company wants more revenue per seat without making frequent customers feel punished.\n\nA strong operator would separate scarce perks from scalable benefits, then protect the parts customers value most.\n\nThe outcome to watch is behavior, not the press release: card spending, elite churn, and premium-seat demand.\n\nLesson: pricing power is strongest when customers believe the bundle still protects status, convenience, or time.\n\nSource: Example Aviation Filing, published 2026-04-25, retrieved 2026-04-26.",
    source_urls: ["https://example.com/airline-loyalty-filing"],
    version: 1
  },
  mini_case: {
    content_type: "mini_case",
    slot: "mini_case",
    topic: "finance",
    language: "en",
    title: "Mini-case: brief a rate-sensitive budget decision",
    difficulty: "medium",
    context: "A university project team is deciding whether to sign a fixed-price vendor contract after rates moved again.",
    challenge: "Brief the decision-maker in five minutes with a recommendation and one risk.",
    constraints: ["Use only sourced facts.", "Separate the immediate cost from second-order effects.", "Name one signal that would change your recommendation."],
    question: "Would you recommend signing now, waiting, or renegotiating terms?",
    expected_reasoning: ["Identify the strongest constraint.", "Compare option value against delay risk.", "Name the uncertainty that could change the decision."],
    sample_answer: "I would renegotiate for a shorter commitment: it preserves access to the vendor while limiting exposure if rates or demand move. Before acting, I would need the latest comparable bids and cancellation terms.",
    body_md:
      "A university project team is deciding whether to sign a fixed-price vendor contract after rates moved again.\n\nYour job is to brief the decision-maker in five minutes with a recommendation and one risk.\n\nUse only sourced facts, separate the immediate cost from second-order effects, and name one signal that would change your recommendation.\n\nQuestion: would you sign now, wait, or renegotiate terms?\n\nSource: Example Rates Note, published 2026-04-26, retrieved 2026-04-26.",
    source_urls: ["https://example.com/rates-note"],
    version: 1
  },
  quick_quiz: {
    content_type: "quick_quiz",
    question: "What is the strongest sign that a company has pricing power?",
    language: "en",
    choices: ["It can raise prices without a damaging loss of customers.", "It is popular on social media.", "It spends more on advertising.", "It launches products quickly."],
    correct_choice: "It can raise prices without a damaging loss of customers.",
    explanation: "Pricing power is about customer behavior after a price change. Popularity can help, but it is not proof unless customers keep buying at the higher price.",
    source_content_item_id: "example-content-item-id",
    source_urls: ["https://example.com/pricing-power-source"]
  },
  concept: {
    content_type: "concept",
    slot: "concept",
    topic: "business",
    language: "en",
    title: "Pricing power",
    category: "business",
    definition: "Pricing power is the ability to raise prices without losing enough demand to damage the business.",
    plain_english: "The real test is not whether customers like the product. It is whether they stay when the product costs more.",
    example: "A company with scarce capacity and loyal customers may lift prices while protecting demand.",
    why_it_matters: "Pricing power turns demand into durable margin instead of temporary attention.",
    how_to_use_it: "When analyzing a business, ask what would happen after a 10 percent price increase and which customers would leave first.",
    common_mistake: "Confusing popularity with willingness to pay.",
    body_md:
      "Pricing power is the ability to raise prices without losing enough demand to damage the business.\n\nPlain English: the real test is not whether customers like the product. It is whether they stay when the product costs more.\n\nUse it when comparing businesses, internship cases, or market entries. Ask what would happen after a 10 percent price increase and which customers would leave first.\n\nCommon mistake: confusing popularity with willingness to pay.\n\nSource: Example Strategy Note, published 2026-04-24, retrieved 2026-04-26.",
    source_urls: ["https://example.com/pricing-power"],
    version: 1
  }
} as const;
