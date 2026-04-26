import type { LibraryDropSummary, LibraryItemSummary } from "../features/library";
import {
  flattenDailyDropItems,
  getTopicsForDrop,
  mockTodayDailyDrops
} from "./todayDrops";

export const mockLibraryDrops = mockTodayDailyDrops.map((drop, index) => {
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

export const mockLibraryItems = mockTodayDailyDrops.flatMap((drop, dropIndex) =>
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
