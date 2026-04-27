import type { RankedArticle, RawArticle } from "../domain.js";
import { deduplicateArticles, prepareCandidates } from "./deduplicate.js";
import { rankArticles } from "./rank.js";

export function processArticles(articles: RawArticle[], now = new Date()): RankedArticle[] {
  return rankArticles(deduplicateArticles(prepareCandidates(articles)), now);
}
