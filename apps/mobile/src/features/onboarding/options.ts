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
  "pharma",
  "ai",
  "culture"
] as const;

export type NewsletterTopicId = (typeof NEWSLETTER_TOPIC_IDS)[number];

export const NEWSLETTER_TO_BACKEND_TOPIC_ID = {
  sport: "sport_business",
  international: "law",
  finance_economy: "finance",
  stock_market: "business",
  automotive: "engineering",
  pharma: "medicine",
  ai: "tech_ai",
  culture: "culture_media"
} as const satisfies Record<NewsletterTopicId, TopicId>;

export type NewsletterTopicOption = OnboardingOption<NewsletterTopicId> & {
  backendTopicId: TopicId;
};

export const ONBOARDING_MODULE_IDS = [
  "newsletter",
  "business_story",
  "mini_case"
] as const;

export type OnboardingModuleId = (typeof ONBOARDING_MODULE_IDS)[number];

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
  "finance_economy",
  "stock_market",
  "ai",
  "law_compliance",
  "health_pharma",
  "engineering_operations"
] as const;

export type MiniCaseTopicId = (typeof MINI_CASE_TOPIC_IDS)[number];

export const MINI_CASE_TO_BACKEND_TOPIC_ID = {
  finance_economy: "finance",
  stock_market: "finance",
  ai: "tech_ai",
  law_compliance: "law",
  health_pharma: "medicine",
  engineering_operations: "engineering"
} as const satisfies Record<MiniCaseTopicId, TopicId>;

export const MODULE_OPTIONS: Array<OnboardingOption<OnboardingModuleId>> = [
  {
    id: "newsletter",
    label: "Newsletter",
    description: "A tight set of daily news signals.",
    translations: {
      en: {
        label: "Newsletter",
        description: "A tight set of daily news signals."
      },
      fr: {
        label: "Newsletter",
        description: "Un ensemble clair de signaux d'actualité."
      }
    }
  },
  {
    id: "business_story",
    label: "Business Stories",
    description: "One short business lesson from a real situation.",
    translations: {
      en: {
        label: "Business Stories",
        description: "One short business lesson from a real situation."
      },
      fr: {
        label: "Histoires business",
        description: "Une leçon business courte tirée d'une situation réelle."
      }
    }
  },
  {
    id: "mini_case",
    label: "Mini Cases",
    description: "Practice decision-making with concise cases.",
    translations: {
      en: {
        label: "Mini Cases",
        description: "Practice decision-making with concise cases."
      },
      fr: {
        label: "Mini-cas",
        description: "Entraîne ta prise de décision avec des cas courts."
      }
    }
  }
];

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
    id: "pharma",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.pharma,
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
    id: "ai",
    backendTopicId: NEWSLETTER_TO_BACKEND_TOPIC_ID.ai,
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
      fr: ["Finance / Économie", "Arbitrages de budget, risque, taux, valorisation et choix de capital."]
    },
    stock_market: {
      en: ["Stock Market", "Valuation, earnings, investor reactions, risk, and market timing."],
      fr: ["Marché actions", "Valorisation, résultats, réactions d'investisseurs, risque et timing de marché."]
    },
    ai: {
      en: ["Artificial Intelligence", "AI adoption, product choices, platforms, data, and regulation."],
      fr: ["Intelligence artificielle", "Adoption de l'IA, choix produit, plateformes, données et régulation."]
    },
    law_compliance: {
      en: ["Law / Compliance", "Rules, liability, compliance, negotiations, and institutional constraints."],
      fr: ["Droit / Conformité", "Règles, responsabilité, conformité, négociations et contraintes institutionnelles."]
    },
    health_pharma: {
      en: ["Health / Pharma", "Clinical evidence, health systems, safety, access, and pharma strategy."],
      fr: ["Santé / Pharma", "Preuves cliniques, systèmes de santé, sécurité, accès et stratégie pharma."]
    },
    engineering_operations: {
      en: ["Engineering / Operations", "Systems, infrastructure, manufacturing, constraints, and reliability."],
      fr: ["Ingénierie / Opérations", "Systèmes, infrastructure, production, contraintes et fiabilité."]
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
      return "law_compliance";
    case "finance":
      return "finance_economy";
    case "tech_ai":
      return "ai";
    case "business":
      return "stock_market";
    case "medicine":
      return "health_pharma";
    case "engineering":
      return "engineering_operations";
    case "sport_business":
      return "stock_market";
    case "culture_media":
      return "ai";
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

export function normalizeNewsletterTopics(topicIds: readonly string[]) {
  const normalizedTopicIds = topicIds
    .map((topicId) => normalizeNewsletterTopicId(topicId))
    .filter((topicId): topicId is NewsletterTopicId => Boolean(topicId));

  return normalizedTopicIds.filter(
    (topicId, index, topics) => topics.indexOf(topicId) === index
  );
}

function normalizeNewsletterTopicId(topicId: string): NewsletterTopicId | null {
  if (isNewsletterTopicId(topicId)) {
    return topicId;
  }

  if (topicId === "pharmaceutical") {
    return "pharma";
  }

  if (topicId === "artificial_intelligence") {
    return "ai";
  }

  return null;
}

export function isMiniCaseTopicId(value: string): value is MiniCaseTopicId {
  return MINI_CASE_TOPIC_IDS.includes(value as MiniCaseTopicId);
}

export function normalizeMiniCaseTopics(topicIds: readonly string[]) {
  const normalizedTopicIds = topicIds
    .map((topicId) => normalizeMiniCaseTopicId(topicId))
    .filter((topicId): topicId is MiniCaseTopicId => Boolean(topicId));

  return normalizedTopicIds
    .filter((topicId, index, topics) => topics.indexOf(topicId) === index)
    .slice(0, MAX_MINI_CASE_TOPICS);
}

function normalizeMiniCaseTopicId(topicId: string): MiniCaseTopicId | null {
  if (isMiniCaseTopicId(topicId)) {
    return topicId;
  }

  switch (topicId) {
    case "finance":
      return "finance_economy";
    case "tech_ai":
    case "artificial_intelligence":
      return "ai";
    case "medicine":
    case "health":
      return "health_pharma";
    case "law":
      return "law_compliance";
    case "engineering":
      return "engineering_operations";
    case "business":
    case "market":
    case "sport_business":
    case "entrepreneurship":
      return "stock_market";
    case "culture_media":
      return "ai";
    case "career":
      return "engineering_operations";
    default:
      return null;
  }
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
