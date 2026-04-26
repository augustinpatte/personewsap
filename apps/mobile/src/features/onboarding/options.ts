import type { GoalId, Language, PreferenceFrequency, TopicId } from "../../types/domain";

export type OnboardingOption<Id extends string> = {
  id: Id;
  label: string;
  description: string;
};

export const LANGUAGE_OPTIONS: Array<OnboardingOption<Language>> = [
  {
    id: "fr",
    label: "Francais",
    description: "Briefing clair, direct, pense en francais."
  },
  {
    id: "en",
    label: "English",
    description: "Sharp daily briefing written naturally in English."
  }
];

export const GOAL_OPTIONS: Array<OnboardingOption<GoalId>> = [
  {
    id: "understand_world",
    label: "Understand the world",
    description: "Get context that makes major stories easier to read."
  },
  {
    id: "prepare_career",
    label: "Prepare for career",
    description: "Build useful judgment for interviews, internships, and early roles."
  },
  {
    id: "learn_business",
    label: "Learn business",
    description: "See the mechanics behind companies, markets, and decisions."
  },
  {
    id: "explore_stem",
    label: "Explore STEM",
    description: "Follow science, medicine, engineering, and AI without filler."
  },
  {
    id: "become_sharper_daily",
    label: "Become sharper daily",
    description: "Make five focused minutes compound into better thinking."
  }
];

export const TOPIC_OPTIONS: Array<OnboardingOption<TopicId>> = [
  {
    id: "business",
    label: "Business",
    description: "Strategy, companies, incentives, and operating decisions."
  },
  {
    id: "finance",
    label: "Finance",
    description: "Markets, capital, risk, and economic mechanisms."
  },
  {
    id: "tech_ai",
    label: "Tech / AI",
    description: "Platforms, AI shifts, product bets, and regulation."
  },
  {
    id: "law",
    label: "Law",
    description: "Rules, cases, institutions, and legal incentives."
  },
  {
    id: "medicine",
    label: "Medicine",
    description: "Health systems, research, biotech, and clinical context."
  },
  {
    id: "engineering",
    label: "Engineering",
    description: "Infrastructure, energy, hardware, and technical systems."
  },
  {
    id: "sport_business",
    label: "Sport Business",
    description: "Leagues, media rights, athletes, brands, and money."
  },
  {
    id: "culture_media",
    label: "Culture / Media",
    description: "Attention, creative industries, platforms, and influence."
  }
];

export const FREQUENCY_OPTIONS: Array<
  OnboardingOption<PreferenceFrequency> & { disabled?: boolean; badge?: string }
> = [
  {
    id: "daily",
    label: "Daily",
    description: "One focused drop per day. This is the PersoNewsAP rhythm."
  },
  {
    id: "weekdays",
    label: "Weekdays",
    description: "A school-week cadence for future versions.",
    disabled: true,
    badge: "Coming soon"
  },
  {
    id: "weekly",
    label: "Weekly",
    description: "A slower digest mode for future versions.",
    disabled: true,
    badge: "Coming soon"
  }
];
