import type {
  BusinessStory,
  GeneratedContentItem,
  KeyConcept,
  MiniCaseChallenge,
  NewsletterArticle,
  RankedArticle,
  SourceMetadata
} from "../domain.js";

export type ContentItemInsert = {
  content_type: string;
  topic_id: string | null;
  language: string;
  title: string;
  summary: string | null;
  body_md: string;
  difficulty: string | null;
  estimated_read_seconds: number | null;
  publication_date: string;
  version: number;
  status: string;
  generation_run_id: string | null;
  source_count: number;
  metadata: Record<string, unknown>;
};

export function sourceMetadataFromArticle(article: RankedArticle): SourceMetadata {
  return {
    url: article.url,
    title: article.title,
    publisher: article.publisher,
    author: article.author ?? null,
    published_at: article.published_at ?? null,
    retrieved_at: article.retrieved_at,
    language: article.language,
    content_hash: article.content_hash,
    credibility_score: article.credibility_score ?? 0.6
  };
}

export function mapGeneratedItemToContentInsert(
  item: GeneratedContentItem,
  publicationDate: string,
  status: "draft" | "review" | "published",
  generationRunId: string | null
): ContentItemInsert {
  return {
    content_type: item.content_type,
    topic_id: item.topic,
    language: item.language,
    title: item.title,
    summary: summaryFor(item),
    body_md: bodyFor(item),
    difficulty: difficultyFor(item),
    estimated_read_seconds: estimateReadSeconds(bodyFor(item)),
    publication_date: publicationDate,
    version: item.version,
    status,
    generation_run_id: generationRunId,
    source_count: item.source_urls.length,
    metadata: metadataFor(item)
  };
}

function summaryFor(item: GeneratedContentItem): string | null {
  if (item.content_type === "newsletter_article") {
    return item.summary;
  }

  if (item.content_type === "business_story") {
    return item.lesson;
  }

  if (item.content_type === "mini_case") {
    return item.challenge;
  }

  return item.definition;
}

function bodyFor(item: GeneratedContentItem): string {
  return item.body_md;
}

function difficultyFor(item: GeneratedContentItem): string | null {
  return item.content_type === "mini_case" ? item.difficulty : null;
}

function estimateReadSeconds(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(30, Math.ceil((words / 220) * 60));
}

function metadataFor(item: GeneratedContentItem): Record<string, unknown> {
  switch (item.content_type) {
    case "newsletter_article":
      return newsletterMetadata(item);
    case "business_story":
      return businessStoryMetadata(item);
    case "mini_case":
      return miniCaseMetadata(item);
    case "concept":
      return conceptMetadata(item);
  }
}

function newsletterMetadata(item: NewsletterArticle): Record<string, unknown> {
  return {
    slot: item.slot,
    published_date: item.published_date,
    why_it_matters: item.why_it_matters,
    source_urls: item.source_urls
  };
}

function businessStoryMetadata(item: BusinessStory): Record<string, unknown> {
  return {
    slot: item.slot,
    company_or_market: item.company_or_market,
    story_date: item.story_date,
    setup: item.setup,
    tension: item.tension,
    decision: item.decision,
    outcome: item.outcome,
    lesson: item.lesson,
    source_urls: item.source_urls
  };
}

function miniCaseMetadata(item: MiniCaseChallenge): Record<string, unknown> {
  return {
    slot: item.slot,
    context: item.context,
    challenge: item.challenge,
    constraints: item.constraints,
    question: item.question,
    expected_reasoning: item.expected_reasoning,
    sample_answer: item.sample_answer,
    source_urls: item.source_urls
  };
}

function conceptMetadata(item: KeyConcept): Record<string, unknown> {
  return {
    slot: item.slot,
    category: item.category,
    definition: item.definition,
    plain_english: item.plain_english,
    example: item.example,
    why_it_matters: item.why_it_matters,
    how_to_use_it: item.how_to_use_it,
    common_mistake: item.common_mistake,
    source_urls: item.source_urls
  };
}
