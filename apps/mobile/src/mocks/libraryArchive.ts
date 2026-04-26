import type { LibraryDropSummary, LibraryItemSummary } from "../features/library";
import {
  flattenDailyDropItems,
  getTopicsForDrop,
  mockTodayDailyDrops
} from "./todayDrops";

const currentMockLibraryDrops = mockTodayDailyDrops.map((drop, index) => {
  const items = flattenDailyDropItems(drop);

  return {
    drop_id: drop.id,
    drop_date: drop.drop_date,
    language: drop.language,
    title: drop.title,
    item_count: items.length,
    topics: getTopicsForDrop(drop),
    completed_item_count: index === 0 ? items.length : 3,
    saved_item_count: index === 0 ? 2 : 1
  };
}) satisfies LibraryDropSummary[];

const archivedMockLibraryDrops = [
  {
    drop_id: "drop-2026-04-25-en",
    drop_date: "2026-04-25",
    language: "en",
    title: "Saturday briefing",
    item_count: 4,
    topics: ["finance", "business", "law"],
    completed_item_count: 4,
    saved_item_count: 1
  },
  {
    drop_id: "drop-2026-04-24-en",
    drop_date: "2026-04-24",
    language: "en",
    title: "Friday briefing",
    item_count: 4,
    topics: ["medicine", "tech_ai", "business"],
    completed_item_count: 2,
    saved_item_count: 2
  },
  {
    drop_id: "drop-2026-04-23-fr",
    drop_date: "2026-04-23",
    language: "fr",
    title: "Brief de jeudi",
    item_count: 4,
    topics: ["culture_media", "sport_business", "business"],
    completed_item_count: 3,
    saved_item_count: 1
  }
] satisfies LibraryDropSummary[];

export const mockLibraryDrops = [
  ...currentMockLibraryDrops,
  ...archivedMockLibraryDrops
] satisfies LibraryDropSummary[];

const currentMockLibraryItems = mockTodayDailyDrops.flatMap((drop, dropIndex) =>
  flattenDailyDropItems(drop).map((item, itemIndex) => ({
    id: item.id,
    drop_id: drop.id,
    drop_date: drop.drop_date,
    content_type: item.content_type,
    language: item.language,
    title: item.title,
    topic:
      "topic" in item
        ? item.topic
        : "category" in item
          ? item.category
          : null,
    source_count: item.source_ids.length,
    is_saved: itemIndex === 0 || item.content_type === "key_concept",
    is_completed: dropIndex === 0 || itemIndex < 3
  }))
) satisfies LibraryItemSummary[];

const archivedMockLibraryItems = [
  {
    id: "archive-item-2026-04-25-en-rate-cuts",
    drop_id: "drop-2026-04-25-en",
    drop_date: "2026-04-25",
    content_type: "newsletter_article",
    language: "en",
    title: "Why central bank language moves before rates do",
    topic: "finance",
    source_count: 2,
    is_saved: false,
    is_completed: true
  },
  {
    id: "archive-item-2026-04-25-en-costco",
    drop_id: "drop-2026-04-25-en",
    drop_date: "2026-04-25",
    content_type: "business_story",
    language: "en",
    title: "Costco's membership model makes low margins useful",
    topic: "business",
    source_count: 2,
    is_saved: true,
    is_completed: true
  },
  {
    id: "archive-item-2026-04-25-en-law-case",
    drop_id: "drop-2026-04-25-en",
    drop_date: "2026-04-25",
    content_type: "mini_case",
    language: "en",
    title: "Decide whether a startup should settle a contract dispute",
    topic: "law",
    source_count: 1,
    is_saved: false,
    is_completed: true
  },
  {
    id: "archive-item-2026-04-25-en-regulatory-moat",
    drop_id: "drop-2026-04-25-en",
    drop_date: "2026-04-25",
    content_type: "key_concept",
    language: "en",
    title: "Regulatory moat",
    topic: "business",
    source_count: 1,
    is_saved: false,
    is_completed: true
  },
  {
    id: "archive-item-2026-04-24-en-medical-devices",
    drop_id: "drop-2026-04-24-en",
    drop_date: "2026-04-24",
    content_type: "newsletter_article",
    language: "en",
    title: "Medical device approvals reward clean evidence",
    topic: "medicine",
    source_count: 2,
    is_saved: true,
    is_completed: true
  },
  {
    id: "archive-item-2026-04-24-en-open-source-ai",
    drop_id: "drop-2026-04-24-en",
    drop_date: "2026-04-24",
    content_type: "business_story",
    language: "en",
    title: "Open-source AI changed the price of experimentation",
    topic: "tech_ai",
    source_count: 2,
    is_saved: false,
    is_completed: false
  },
  {
    id: "archive-item-2026-04-24-en-clinic-case",
    drop_id: "drop-2026-04-24-en",
    drop_date: "2026-04-24",
    content_type: "mini_case",
    language: "en",
    title: "Choose a triage metric for a student clinic",
    topic: "medicine",
    source_count: 1,
    is_saved: false,
    is_completed: false
  },
  {
    id: "archive-item-2026-04-24-en-marginal-cost",
    drop_id: "drop-2026-04-24-en",
    drop_date: "2026-04-24",
    content_type: "key_concept",
    language: "en",
    title: "Marginal cost",
    topic: "business",
    source_count: 1,
    is_saved: true,
    is_completed: true
  },
  {
    id: "archive-item-2026-04-23-fr-media-rights",
    drop_id: "drop-2026-04-23-fr",
    drop_date: "2026-04-23",
    content_type: "newsletter_article",
    language: "fr",
    title: "Les droits sportifs deviennent un produit media fragmente",
    topic: "sport_business",
    source_count: 2,
    is_saved: false,
    is_completed: true
  },
  {
    id: "archive-item-2026-04-23-fr-labels",
    drop_id: "drop-2026-04-23-fr",
    drop_date: "2026-04-23",
    content_type: "business_story",
    language: "fr",
    title: "Pourquoi les labels musicaux negocient avec les plateformes IA",
    topic: "culture_media",
    source_count: 2,
    is_saved: false,
    is_completed: true
  },
  {
    id: "archive-item-2026-04-23-fr-stadium",
    drop_id: "drop-2026-04-23-fr",
    drop_date: "2026-04-23",
    content_type: "mini_case",
    language: "fr",
    title: "Fixer le prix d'un abonnement etudiant au stade",
    topic: "sport_business",
    source_count: 1,
    is_saved: true,
    is_completed: false
  },
  {
    id: "archive-item-2026-04-23-fr-bundling",
    drop_id: "drop-2026-04-23-fr",
    drop_date: "2026-04-23",
    content_type: "key_concept",
    language: "fr",
    title: "Bundling",
    topic: "business",
    source_count: 1,
    is_saved: false,
    is_completed: true
  }
] satisfies LibraryItemSummary[];

export const mockLibraryItems = [
  ...currentMockLibraryItems,
  ...archivedMockLibraryItems
] satisfies LibraryItemSummary[];
