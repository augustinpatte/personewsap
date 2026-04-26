export const TOPICS = [
  { id: "business", label: "Business" },
  { id: "finance", label: "Finance" },
  { id: "tech_ai", label: "Tech / AI" },
  { id: "law", label: "Law" },
  { id: "medicine", label: "Medicine" },
  { id: "engineering", label: "Engineering" },
  { id: "sport_business", label: "Sport Business" },
  { id: "culture_media", label: "Culture / Media" }
] as const;

export const GOALS = [
  { id: "understand_world", label: "Understand the world" },
  { id: "prepare_career", label: "Prepare for career" },
  { id: "learn_business", label: "Learn business" },
  { id: "explore_stem", label: "Explore STEM" },
  { id: "become_sharper_daily", label: "Become sharper daily" }
] as const;

export type TopicId = (typeof TOPICS)[number]["id"];
export type GoalId = (typeof GOALS)[number]["id"];
