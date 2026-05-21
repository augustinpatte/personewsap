import type { Language, TopicId } from "../../types/domain";
import { resolveLanguage } from "../../lib/i18n";

type OptionCopy = {
  label: string;
  description: string;
  badge?: string;
};

export type OnboardingOption<Id extends string> = {
  id: Id;
  label: string;
  description: string;
  translations: Record<Language, OptionCopy>;
};

export const LANGUAGE_OPTIONS: Array<OnboardingOption<Language>> = [
  {
    id: "fr",
    label: "Français",
    description: "Briefing clair, direct, pensé en français.",
    translations: {
      en: {
        label: "French",
        description: "A clear, direct briefing written naturally in French."
      },
      fr: {
        label: "Français",
        description: "Briefing clair, direct, pensé en français."
      }
    }
  },
  {
    id: "en",
    label: "English",
    description: "Sharp daily briefing written naturally in English.",
    translations: {
      en: {
        label: "English",
        description: "Sharp daily briefing written naturally in English."
      },
      fr: {
        label: "Anglais",
        description: "Briefing quotidien net, rédigé naturellement en anglais."
      }
    }
  }
];

export const NEWSLETTER_TOPIC_IDS = [
  "sport",
  "international",
  "finance_economy",
  "stock_market",
  "automotive",
  "pharmaceutical",
  "artificial_intelligence",
  "culture"
] as const;

export type NewsletterTopicId = (typeof NEWSLETTER_TOPIC_IDS)[number];

export const NEWSLETTER_TO_BACKEND_TOPIC_ID = {
  sport: "sport_business",
  international: "law",
  finance_economy: "finance",
  stock_market: "business",
  automotive: "engineering",
  pharmaceutical: "medicine",
  artificial_intelligence: "tech_ai",
  culture: "culture_media"
} as const satisfies Record<NewsletterTopicId, TopicId>;

export type NewsletterTopicOption = OnboardingOption<NewsletterTopicId> & {
  backendTopicId: TopicId;
};

export const MIN_NEWSLETTER_ARTICLES_PER_TOPIC = 1;
export const MAX_NEWSLETTER_ARTICLES_PER_TOPIC = 3;

export type NewsletterTopicArticleCounts = Partial<Record<NewsletterTopicId, number>>;

export type NewsletterTopicPreferenceRow = {
  user_id: string;
  topic_id: TopicId;
  articles_count: number;
  enabled: boolean;
  position: number;
};

export const TOPIC_OPTIONS: NewsletterTopicOption[] = [
  {
    id: "sport",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.sport,
    label: "Sport",
    description: "Sport leagues, athletes, competitions, media rights, and business moves.",
    translations: {
      en: {
        label: "Sport",
        description: "Sport leagues, athletes, competitions, media rights, and business moves."
      },
      fr: {
        label: "Sport",
        description: "Ligues, athlètes, compétitions, droits médias et décisions business."
      }
    }
  },
  {
    id: "international",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.international,
    label: "International",
    description: "Geopolitics, institutions, trade, regulation, and global decisions.",
    translations: {
      en: {
        label: "International",
        description: "Geopolitics, institutions, trade, regulation, and global decisions."
      },
      fr: {
        label: "International",
        description: "Géopolitique, institutions, commerce, régulation et décisions mondiales."
      }
    }
  },
  {
    id: "finance_economy",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.finance_economy,
    label: "Finance & Economy",
    description: "Macroeconomics, capital, rates, risk, and budget trade-offs.",
    translations: {
      en: {
        label: "Finance & Economy",
        description: "Macroeconomics, capital, rates, risk, and budget trade-offs."
      },
      fr: {
        label: "Finance & économie",
        description: "Macroéconomie, capital, taux, risque et arbitrages de budget."
      }
    }
  },
  {
    id: "stock_market",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.stock_market,
    label: "Stock Market",
    description: "Listed companies, earnings, valuations, sectors, and market signals.",
    translations: {
      en: {
        label: "Stock Market",
        description: "Listed companies, earnings, valuations, sectors, and market signals."
      },
      fr: {
        label: "Bourse",
        description: "Entreprises cotées, résultats, valorisations, secteurs et signaux de marché."
      }
    }
  },
  {
    id: "automotive",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.automotive,
    label: "Automotive",
    description: "Vehicles, mobility, manufacturing, energy, infrastructure, and constraints.",
    translations: {
      en: {
        label: "Automotive",
        description: "Vehicles, mobility, manufacturing, energy, infrastructure, and constraints."
      },
      fr: {
        label: "Automobile",
        description: "Véhicules, mobilité, industrie, énergie, infrastructure et contraintes."
      }
    }
  },
  {
    id: "pharmaceutical",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.pharmaceutical,
    label: "Pharmaceutical",
    description: "Drugmakers, trials, health systems, biotech, access, and safety choices.",
    translations: {
      en: {
        label: "Pharmaceutical",
        description: "Drugmakers, trials, health systems, biotech, access, and safety choices."
      },
      fr: {
        label: "Pharmaceutique",
        description: "Laboratoires, essais, systèmes de santé, biotech, accès et sécurité."
      }
    }
  },
  {
    id: "artificial_intelligence",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.artificial_intelligence,
    label: "Artificial Intelligence",
    description: "AI models, platforms, product bets, compute, regulation, and adoption.",
    translations: {
      en: {
        label: "Artificial Intelligence",
        description: "AI models, platforms, product bets, compute, regulation, and adoption."
      },
      fr: {
        label: "Intelligence artificielle",
        description: "Modèles IA, plateformes, paris produit, calcul, régulation et adoption."
      }
    }
  },
  {
    id: "culture",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.culture,
    label: "Culture",
    description: "Culture, media, creative industries, platforms, attention, and influence.",
    translations: {
      en: {
        label: "Culture",
        description: "Culture, media, creative industries, platforms, attention, and influence."
      },
      fr: {
        label: "Culture",
        description: "Culture, médias, industries créatives, plateformes, attention et influence."
      }
    }
  }
];

export function localizeOptions<Option extends OnboardingOption<string>>(
  options: Option[],
  language: Language | null | undefined
): Option[] {
  const resolvedLanguage = resolveLanguage(language);

  return options.map((option) => ({
    ...option,
    ...option.translations[resolvedLanguage]
  }));
}

export function isNewsletterTopicId(value: string): value is NewsletterTopicId {
  return NEWSLETTER_TOPIC_IDS.includes(value as NewsletterTopicId);
}

export function mapNewsletterTopicToBackendTopic(topicId: NewsletterTopicId): TopicId {
  return NEWSLETTER_TO_BACKEND_TOPIC_ID[topicId];
}

export function mapBackendTopicToNewsletterTopic(topicId: TopicId): NewsletterTopicId | null {
  return TOPIC_OPTIONS.find((option) => option.backendTopicId === topicId)?.id ?? null;
}

export function clampNewsletterArticleCount(count: number) {
  return Math.min(
    Math.max(Math.floor(count), MIN_NEWSLETTER_ARTICLES_PER_TOPIC),
    MAX_NEWSLETTER_ARTICLES_PER_TOPIC
  );
}

export function normalizeNewsletterTopics(topicIds: readonly NewsletterTopicId[]) {
  return topicIds.filter(
    (topicId, index, topics) =>
      isNewsletterTopicId(topicId) && topics.indexOf(topicId) === index
  );
}

export function buildNewsletterTopicPreferenceRows({
  articlesPerTopic,
  selectedTopics,
  userId
}: {
  articlesPerTopic: NewsletterTopicArticleCounts;
  selectedTopics: readonly NewsletterTopicId[];
  userId: string;
}): NewsletterTopicPreferenceRow[] {
  const normalizedSelectedTopics = normalizeNewsletterTopics(selectedTopics);
  const selectedTopicIds = new Set(normalizedSelectedTopics);

  return TOPIC_OPTIONS.map((topic, index) => {
    const enabled = selectedTopicIds.has(topic.id);
    const selectedPosition = normalizedSelectedTopics.indexOf(topic.id);

    return {
      user_id: userId,
      topic_id: topic.backendTopicId,
      articles_count: enabled
        ? clampNewsletterArticleCount(articlesPerTopic[topic.id] ?? 1)
        : 1,
      enabled,
      position:
        enabled && selectedPosition >= 0
          ? selectedPosition + 1
          : normalizedSelectedTopics.length + index + 1
    };
  });
}

export function normalizeMiniCaseTopicId(
  selectedTopics: readonly NewsletterTopicId[],
  miniCaseTopicId: NewsletterTopicId | null | undefined
): NewsletterTopicId | null {
  const normalizedTopics = normalizeNewsletterTopics(selectedTopics);

  if (normalizedTopics.length === 0) {
    return null;
  }

  if (miniCaseTopicId && normalizedTopics.includes(miniCaseTopicId)) {
    return miniCaseTopicId;
  }

  return normalizedTopics.length === 1 ? normalizedTopics[0] : null;
}
