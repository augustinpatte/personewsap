import type { TopicId } from "../../constants/product";
import type { ContentLanguage, ContentType } from "../today";

export type LibraryDropSummary = {
  drop_id: string;
  drop_date: string;
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
