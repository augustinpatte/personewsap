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
  "business",
  "finance",
  "tech_ai",
  "law",
  "medicine",
  "engineering",
  "sport_business",
  "culture_media"
] as const satisfies readonly TopicId[];

export const MIN_NEWSLETTER_ARTICLES_PER_TOPIC = 1;
export const MAX_NEWSLETTER_ARTICLES_PER_TOPIC = 3;

export const TOPIC_OPTIONS: Array<OnboardingOption<(typeof NEWSLETTER_TOPIC_IDS)[number]>> = [
  {
    id: "business",
    label: "Business",
    description: "Strategy, companies, incentives, and operating decisions.",
    translations: {
      en: {
        label: "Business",
        description: "Strategy, companies, incentives, and operating decisions."
      },
      fr: {
        label: "Business",
        description: "Stratégie, entreprises, incitations et décisions opérationnelles."
      }
    }
  },
  {
    id: "finance",
    label: "Finance",
    description: "Markets, capital, risk, and budget trade-offs.",
    translations: {
      en: {
        label: "Finance",
        description: "Markets, capital, risk, and budget trade-offs."
      },
      fr: {
        label: "Finance",
        description: "Marchés, capital, risque et arbitrages de budget."
      }
    }
  },
  {
    id: "tech_ai",
    label: "Tech / AI",
    description: "Platforms, AI shifts, product bets, and regulation.",
    translations: {
      en: {
        label: "Tech / AI",
        description: "Platforms, AI shifts, product bets, and regulation."
      },
      fr: {
        label: "Tech / IA",
        description: "Plateformes, ruptures IA, paris produit et régulation."
      }
    }
  },
  {
    id: "law",
    label: "Law",
    description: "Rules, cases, compliance, and institutional decisions.",
    translations: {
      en: {
        label: "Law",
        description: "Rules, cases, compliance, and institutional decisions."
      },
      fr: {
        label: "Droit",
        description: "Règles, affaires, conformité et décisions institutionnelles."
      }
    }
  },
  {
    id: "medicine",
    label: "Medicine",
    description: "Clinical evidence, health systems, biotech, and safety choices.",
    translations: {
      en: {
        label: "Medicine",
        description: "Clinical evidence, health systems, biotech, and safety choices."
      },
      fr: {
        label: "Médecine",
        description: "Preuves cliniques, systèmes de santé, biotech et choix de sécurité."
      }
    }
  },
  {
    id: "engineering",
    label: "Engineering",
    description: "Infrastructure, energy, hardware, reliability, and constraints.",
    translations: {
      en: {
        label: "Engineering",
        description: "Infrastructure, energy, hardware, reliability, and constraints."
      },
      fr: {
        label: "Ingénierie",
        description: "Infrastructure, énergie, hardware, fiabilité et contraintes."
      }
    }
  },
  {
    id: "sport_business",
    label: "Sport Business",
    description: "Leagues, media rights, athletes, brands, and money.",
    translations: {
      en: {
        label: "Sport Business",
        description: "Leagues, media rights, athletes, brands, and money."
      },
      fr: {
        label: "Business du sport",
        description: "Ligues, droits médias, athlètes, marques et argent."
      }
    }
  },
  {
    id: "culture_media",
    label: "Culture / Media",
    description: "Attention, creative industries, platforms, and influence.",
    translations: {
      en: {
        label: "Culture / Media",
        description: "Attention, creative industries, platforms, and influence."
      },
      fr: {
        label: "Culture / médias",
        description: "Attention, industries créatives, plateformes et influence."
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

export function isNewsletterTopicId(value: string): value is TopicId {
  return NEWSLETTER_TOPIC_IDS.includes(value as TopicId);
}

export function clampNewsletterArticleCount(count: number) {
  return Math.min(
    Math.max(Math.floor(count), MIN_NEWSLETTER_ARTICLES_PER_TOPIC),
    MAX_NEWSLETTER_ARTICLES_PER_TOPIC
  );
}

export function normalizeNewsletterTopics(topicIds: readonly TopicId[]) {
  return topicIds.filter(
    (topicId, index, topics) =>
      isNewsletterTopicId(topicId) && topics.indexOf(topicId) === index
  );
}
