# PersoNewsAP Content System

## Writing Tone

PersoNewsAP content should feel premium, direct, and useful for ambitious young adults.

Write like a sharp mentor briefing a smart student before class, an interview, an internship, or a serious conversation. Avoid generic AI filler, vague motivation, empty transitions, and overexplaining obvious ideas.

Preferred style:

- Clear and concrete.
- Short paragraphs.
- Strong verbs.
- Useful context before opinion.
- Practical implications.
- No hype without evidence.
- No patronizing student tone.

Avoid:

- "In today's fast-paced world..."
- "It is important to note..."
- "This highlights the importance of..."
- Generic conclusions.
- Unsupported predictions.
- Fake certainty.

## FR/EN Content Parity Rules

FR and EN must carry the same editorial idea, but they should be naturally written in each language.

Rules:

- Same sources.
- Same core facts.
- Same publication date.
- Same editorial angle.
- Similar length and depth.
- Natural phrasing in each language.
- No literal translation when it sounds awkward.
- Localize idioms, examples, and rhythm when useful.

If one language version needs a different sentence structure to feel natural, prefer natural writing over word-by-word equivalence.

## Newsletter Article Format

Each newsletter article should include:

- `title`
- `topic`
- `language`
- `published_date`
- `summary`
- `body`
- `why_it_matters`
- `sources`
- `version`

Recommended structure:

1. What happened
2. Context
3. Why it matters
4. What to watch next

Length target:

- 120-220 words per article for mobile reading.
- Shorter is acceptable when the story is simple.
- Longer requires a strong reason.

## Business Story Format

The business story explains a business mechanism through one concrete story.

It should include:

- `title`
- `company_or_market`
- `language`
- `story_date`
- `setup`
- `tension`
- `decision`
- `outcome`
- `lesson`
- `sources`
- `version`

Good business story subjects:

- Pricing power.
- Distribution.
- Network effects.
- Brand strategy.
- Operational leverage.
- Failed expansion.
- Founder decision.
- Regulation changing incentives.
- Market entry.

The story should teach one clear business lesson without becoming a textbook chapter.

## Mini-Case Challenge Format

The mini-case is a short practical thinking exercise.

It should include:

- `title`
- `language`
- `topic`
- `difficulty`
- `context`
- `challenge`
- `constraints`
- `question`
- `expected_reasoning`
- `sample_answer`
- `sources`
- `version`

Recommended flow:

1. Set the scene in 3-5 sentences.
2. Give the user one decision or recommendation to make.
3. Add constraints.
4. Ask for a short response.
5. Offer a sample answer or feedback after submission.

The mini-case should be practical, not academic trivia.

## Quick Quiz Format

Quick quizzes are optional reinforcement tools, especially after concepts or mini-cases.

Each quiz should include:

- `question`
- `language`
- `choices`
- `correct_choice`
- `explanation`
- `source_content_item_id`

Rules:

- One correct answer.
- Three or four choices.
- No trick questions.
- Explanation must teach the point, not only say why the answer is correct.
- Keep it under 45 seconds.

## Key Concept Format

The key concept teaches one reusable idea.

It should include:

- `title`
- `language`
- `category`
- `definition`
- `plain_english`
- `example`
- `why_it_matters`
- `how_to_use_it`
- `common_mistake`
- `sources`
- `version`

Examples:

- Opportunity cost.
- Regulatory moat.
- Compounding.
- Adverse selection.
- Switching costs.
- Clinical trial phases.
- Systems thinking.
- Marginal cost.

Length target:

- 180-280 words.
- Must be useful in a conversation, interview, class, or internship.

## Sourcing Rules

Every factual content item must be sourced.

Rules:

- Store source URLs and metadata.
- Prefer primary sources when available.
- Use reputable reporting and institutional sources.
- Include source publication dates when available.
- Include retrieval date.
- Link claims to sources where possible.
- Avoid using unsourced social posts as primary evidence.
- Do not cite a source that was not used.
- Do not invent URLs, authors, dates, institutions, or quotes.

Source metadata should include:

- `url`
- `title`
- `publisher`
- `author`
- `published_at`
- `retrieved_at`
- `language`
- `content_hash`

## Legal, Medical, And Financial Safety Rules

PersoNewsAP may cover law, medicine, and finance, but it must not provide personal professional advice.

Rules:

- Explain concepts, events, incentives, and implications.
- Do not tell users what stock to buy or sell.
- Do not provide individualized investment advice.
- Do not provide diagnosis or treatment advice.
- Do not provide legal advice for a user's specific case.
- Add caution when content touches regulated or high-stakes topics.
- Prefer educational framing.
- Clearly distinguish facts, analysis, and uncertainty.
- Avoid overstating medical study results.
- Mention jurisdiction when legal content is jurisdiction-specific.

When uncertain, write less and cite more.

## JSON Output Expectations For Generation

Generation jobs should return structured JSON. The app should not parse free-form model output as the source of truth.

### Daily Drop JSON

```json
{
  "drop_date": "YYYY-MM-DD",
  "language": "en",
  "prompt_version": "daily_drop_v1",
  "items": [
    {
      "slot": "newsletter",
      "content_type": "newsletter_article",
      "topic": "business",
      "title": "string",
      "summary": "string",
      "body_md": "string",
      "why_it_matters": "string",
      "sources": ["source_id_or_url"],
      "version": 1
    },
    {
      "slot": "business_story",
      "content_type": "business_story",
      "title": "string",
      "setup": "string",
      "tension": "string",
      "decision": "string",
      "outcome": "string",
      "lesson": "string",
      "sources": ["source_id_or_url"],
      "version": 1
    },
    {
      "slot": "mini_case",
      "content_type": "mini_case",
      "title": "string",
      "difficulty": "medium",
      "context": "string",
      "challenge": "string",
      "constraints": ["string"],
      "question": "string",
      "expected_reasoning": ["string"],
      "sample_answer": "string",
      "sources": ["source_id_or_url"],
      "version": 1
    },
    {
      "slot": "concept",
      "content_type": "concept",
      "title": "string",
      "definition": "string",
      "plain_english": "string",
      "example": "string",
      "why_it_matters": "string",
      "how_to_use_it": "string",
      "common_mistake": "string",
      "sources": ["source_id_or_url"],
      "version": 1
    }
  ]
}
```

### Validation Requirements

A generated item is invalid if:

- It has no source.
- It has missing required fields.
- It includes invented facts.
- It includes high-stakes advice.
- It has a generic AI conclusion.
- It does not match the requested language.
- Its topic is outside the approved taxonomy.
- Its content type is outside the approved modules.
