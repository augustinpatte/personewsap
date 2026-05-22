export const NEWSLETTER_TOPIC_KEYS = [
  'sport',
  'international',
  'finance_economy',
  'stock_market',
  'automotive',
  'pharma',
  'artificial_intelligence',
  'culture',
] as const;

export type NewsletterTopicKey = (typeof NEWSLETTER_TOPIC_KEYS)[number];

const STORAGE_TOPIC_BY_NEWSLETTER_TOPIC: Record<NewsletterTopicKey, string> = {
  sport: 'sport',
  international: 'international',
  finance_economy: 'finance',
  stock_market: 'stocks',
  automotive: 'automotive',
  pharma: 'pharma',
  artificial_intelligence: 'ai',
  culture: 'culture',
};

const NEWSLETTER_TOPIC_BY_STORAGE_TOPIC: Record<string, NewsletterTopicKey> = {
  sport: 'sport',
  sports: 'sport',
  international: 'international',
  finance: 'finance_economy',
  finance_economy: 'finance_economy',
  stocks: 'stock_market',
  stock_market: 'stock_market',
  automotive: 'automotive',
  pharma: 'pharma',
  artificial_intelligence: 'artificial_intelligence',
  ai: 'artificial_intelligence',
  culture: 'culture',
};

export const STORAGE_TOPIC_KEYS = NEWSLETTER_TOPIC_KEYS.map(
  (topicKey) => STORAGE_TOPIC_BY_NEWSLETTER_TOPIC[topicKey]
);

export function mapNewsletterTopicKeyToStorageTopic(topicKey: string): string {
  return STORAGE_TOPIC_BY_NEWSLETTER_TOPIC[topicKey as NewsletterTopicKey] ?? topicKey;
}

export function mapStorageTopicToNewsletterTopicKey(topicKey: string): NewsletterTopicKey | string {
  return NEWSLETTER_TOPIC_BY_STORAGE_TOPIC[topicKey] ?? topicKey;
}
