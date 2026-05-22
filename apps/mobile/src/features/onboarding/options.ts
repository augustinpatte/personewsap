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

export const MINI_CASE_TOPIC_IDS = [
  "law",
  "finance_economy",
  "artificial_intelligence",
  "stock_market",
  "engineering",
  "health",
  "entrepreneurship",
  "career"
] as const;

export type MiniCaseTopicId = (typeof MINI_CASE_TOPIC_IDS)[number];

export const MINI_CASE_TO_BACKEND_TOPIC_ID = {
  law: "law",
  finance_economy: "finance",
  artificial_intelligence: "tech_ai",
  stock_market: "business",
  engineering: "engineering",
  health: "medicine",
  entrepreneurship: "business",
  career: "business"
} as const satisfies Record<MiniCaseTopicId, TopicId>;

export type MiniCaseTopicOption = OnboardingOption<MiniCaseTopicId> & {
  backendTopicId: TopicId;
};

export type MiniCaseTopicPreferenceRow = {
  user_id: string;
  topic_id: MiniCaseTopicId;
  enabled: boolean;
  position: number;
};

export const MIN_MINI_CASE_TOPICS = 1;
export const MAX_MINI_CASE_TOPICS = 3;

export const TOPIC_OPTIONS: NewsletterTopicOption[] = [
  {
    id: "sport",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.sport,
    label: "Sports",
    description: "Sport leagues, athletes, competitions, media rights, and business moves.",
    translations: {
      en: {
        label: "Sports",
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
    description: "Global decisions, institutions, geopolitics, trade, and regulation.",
    translations: {
      en: {
        label: "International",
        description: "Global decisions, institutions, geopolitics, trade, and regulation."
      },
      fr: {
        label: "International",
        description: "Décisions mondiales, institutions, géopolitique, commerce et régulation."
      }
    }
  },
  {
    id: "finance_economy",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.finance_economy,
    label: "Finance / Economy",
    description: "Macroeconomics, capital, rates, risk, and budget trade-offs.",
    translations: {
      en: {
        label: "Finance / Economy",
        description: "Macroeconomics, capital, rates, risk, and budget trade-offs."
      },
      fr: {
        label: "Finance / Économie",
        description: "Macroéconomie, capital, taux, risque et arbitrages de budget."
      }
    }
  },
  {
    id: "stock_market",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.stock_market,
    label: "Stock Market",
    description: "Stocks, earnings, sectors, valuation, and market signals.",
    translations: {
      en: {
        label: "Stock Market",
        description: "Stocks, earnings, sectors, valuation, and market signals."
      },
      fr: {
        label: "Marché actions",
        description: "Actions, résultats, secteurs, valorisation et signaux de marché."
      }
    }
  },
  {
    id: "automotive",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.automotive,
    label: "Automotive Industry",
    description: "Automakers, mobility, manufacturing, energy, infrastructure, and constraints.",
    translations: {
      en: {
        label: "Automotive Industry",
        description: "Automakers, mobility, manufacturing, energy, infrastructure, and constraints."
      },
      fr: {
        label: "Industrie automobile",
        description: "Constructeurs, mobilité, production, énergie, infrastructure et contraintes."
      }
    }
  },
  {
    id: "pharmaceutical",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.pharmaceutical,
    label: "Pharmaceutical Industry",
    description: "Drugmakers, biotech, clinical evidence, access, regulation, and safety.",
    translations: {
      en: {
        label: "Pharmaceutical Industry",
        description: "Drugmakers, biotech, clinical evidence, access, regulation, and safety."
      },
      fr: {
        label: "Industrie pharmaceutique",
        description: "Laboratoires, biotech, preuves cliniques, accès, régulation et sécurité."
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

export const MINI_CASE_TOPIC_OPTIONS: MiniCaseTopicOption[] = MINI_CASE_TOPIC_IDS.map((id) => {
  const copy = {
    finance_economy: {
      en: ["Finance / Economy", "Budget trade-offs, risk, rates, valuation, and capital choices."],
      fr: ["Finance / économie", "Arbitrages de budget, risque, taux, valorisation et choix de capital."]
    },
    law: {
      en: ["Law", "Rules, liability, compliance, negotiations, and institutional constraints."],
      fr: ["Droit", "Règles, responsabilité, conformité, négociations et contraintes institutionnelles."]
    },
    artificial_intelligence: {
      en: ["Artificial Intelligence", "AI adoption, product choices, platforms, data, and regulation."],
      fr: ["Intelligence artificielle", "Adoption de l'IA, choix produit, plateformes, données et régulation."]
    },
    engineering: {
      en: ["Engineering", "Systems, infrastructure, manufacturing, constraints, and reliability."],
      fr: ["Ingénierie", "Systèmes, infrastructure, industrie, contraintes et fiabilité."]
    },
    stock_market: {
      en: ["Stock Market", "Valuation, earnings, investor reactions, risk, and market timing."],
      fr: ["Bourse", "Valorisation, résultats, réactions d'investisseurs, risque et timing de marché."]
    },
    health: {
      en: ["Health", "Clinical evidence, health systems, safety, access, and ethics."],
      fr: ["Santé", "Preuves cliniques, systèmes de santé, sécurité, accès et éthique."]
    },
    entrepreneurship: {
      en: ["Entrepreneurship", "Strategy, pricing, operations, growth, and market positioning."],
      fr: ["Entrepreneuriat", "Stratégie, prix, opérations, croissance et positionnement de marché."]
    },
    career: {
      en: ["Career", "Workplace choices, skills, negotiation, leadership, and career moves."],
      fr: ["Carrière", "Choix professionnels, compétences, négociation, leadership et trajectoires."]
    }
  } satisfies Record<MiniCaseTopicId, Record<Language, [string, string]>>;

  return {
    id,
    backendTopicId: MINI_CASE_TO_BACKEND_TOPIC_ID[id],
    label: copy[id].en[0],
    description: copy[id].en[1],
    translations: {
      en: {
        label: copy[id].en[0],
        description: copy[id].en[1]
      },
      fr: {
        label: copy[id].fr[0],
        description: copy[id].fr[1]
      }
    }
  };
});

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

export function mapMiniCaseTopicToBackendTopic(topicId: MiniCaseTopicId): TopicId {
  return MINI_CASE_TO_BACKEND_TOPIC_ID[topicId];
}

export function mapBackendTopicToMiniCaseTopic(topicId: TopicId): MiniCaseTopicId | null {
  switch (topicId) {
    case "law":
      return "law";
    case "finance":
      return "finance_economy";
    case "tech_ai":
      return "artificial_intelligence";
    case "business":
      return "entrepreneurship";
    case "medicine":
      return "health";
    case "engineering":
      return "engineering";
    case "sport_business":
      return "entrepreneurship";
    case "culture_media":
      return "career";
    default:
      return null;
  }
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

export function isMiniCaseTopicId(value: string): value is MiniCaseTopicId {
  return MINI_CASE_TOPIC_IDS.includes(value as MiniCaseTopicId);
}

export function normalizeMiniCaseTopics(topicIds: readonly MiniCaseTopicId[]) {
  return topicIds
    .filter(
      (topicId, index, topics) =>
        isMiniCaseTopicId(topicId) && topics.indexOf(topicId) === index
    )
    .slice(0, MAX_MINI_CASE_TOPICS);
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

export function buildMiniCaseTopicPreferenceRows({
  selectedTopics,
  userId
}: {
  selectedTopics: readonly MiniCaseTopicId[];
  userId: string;
}): MiniCaseTopicPreferenceRow[] {
  const normalizedSelectedTopics = normalizeMiniCaseTopics(selectedTopics);
  const selectedTopicIds = new Set(normalizedSelectedTopics);

  return MINI_CASE_TOPIC_OPTIONS.map((topic, index) => {
    const enabled = selectedTopicIds.has(topic.id);
    const selectedPosition = normalizedSelectedTopics.indexOf(topic.id);
    return {
      user_id: userId,
      topic_id: topic.id,
      enabled,
      position:
        enabled && selectedPosition >= 0
          ? selectedPosition + 1
          : index + 1
    };
  });
}
