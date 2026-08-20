import type { TopicId } from "../../constants/product";
import type { ContentLanguage, ContentType } from "../today";

export type LibraryDropSummary = {
  drop_id: string;
  drop_date: string;
  /**
   * Display-only: this edition is rendered without its calendar date. It still
   * has a real drop_date, and sorting, cadence and weekly-digest detection all
   * keep using it. Absent on rows written before the flag existed, which is
   * read as false.
   */
  hide_display_date: boolean;
  language: ContentLanguage;
  title: string;
  item_count: number;
  topics: TopicId[];
  completed_item_count: number;
  saved_item_count: number;
  items?: LibraryItemSummary[];
};

export type LibraryItemSummary = {
  id: string;
  drop_id: string;
  drop_date: string;
  /** Display-only, inherited from the edition this item was served in. */
  hide_display_date: boolean;
  content_type: ContentType;
  language: ContentLanguage;
  title: string;
  topic: TopicId | "career" | null;
  source_count: number;
  is_saved: boolean;
  is_completed: boolean;
};

export type LibraryFilter = {
  language?: ContentLanguage;
  content_type?: ContentType;
  topic?: TopicId;
  saved_only?: boolean;
  completed_only?: boolean;
};
