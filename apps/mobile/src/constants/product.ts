export const TOPICS = [
  { id: "business", label: "Stock Market" },
  { id: "finance", label: "Finance & Economy" },
  { id: "tech_ai", label: "Artificial Intelligence" },
  { id: "law", label: "Law" },
  { id: "medicine", label: "Health" },
  { id: "engineering", label: "Engineering" },
  { id: "sport_business", label: "Sport" },
  { id: "culture_media", label: "Culture" }
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
