import type { TopicId } from "../constants/product";
import type {
  ContentLanguage,
  DailyDropContentItem,
  SourceMetadata,
  TodayDailyDrop
} from "../features/today";

export const mockSources = {
  "eu-ai-act-2024-08-01": {
    id: "eu-ai-act-2024-08-01",
    url: "https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai",
    title: "AI Act",
    publisher: "European Commission",
    author: "European Commission",
    published_at: "2024-08-01",
    retrieved_at: "2026-04-26",
    language: "en",
    content_hash: "mock:eu-ai-act-policy-page-2024-08-01"
  },
  "eur-lex-ai-act-2024-1689": {
    id: "eur-lex-ai-act-2024-1689",
    url: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
    title: "Regulation (EU) 2024/1689",
    publisher: "Official Journal of the European Union",
    author: "European Parliament and Council of the European Union",
    published_at: "2024-07-12",
    retrieved_at: "2026-04-26",
    language: "multi",
    content_hash: "mock:eur-lex-regulation-2024-1689"
  },
  "eu-common-charger": {
    id: "eu-common-charger",
    url: "https://single-market-economy.ec.europa.eu/sectors/electrical-and-electronic-engineering-industries-eei/radio-equipment-directive-red/common-charging-solution_en",
    title: "Common charging solution",
    publisher: "European Commission",
    author: "European Commission",
    published_at: null,
    retrieved_at: "2026-04-26",
    language: "en",
    content_hash: "mock:eu-common-charging-solution"
  },
  "netflix-q4-2023-letter": {
    id: "netflix-q4-2023-letter",
    url: "https://s22.q4cdn.com/959853165/files/doc_financials/2023/q4/FINAL-Q4-23-Shareholder-Letter.pdf",
    title: "Q4 2023 Shareholder Letter",
    publisher: "Netflix Investor Relations",
    author: "Netflix, Inc.",
    published_at: "2024-01-23",
    retrieved_at: "2026-04-26",
    language: "en",
    content_hash: "mock:netflix-q4-2023-shareholder-letter"
  }
} satisfies Record<string, SourceMetadata>;

export type MockSourceId = keyof typeof mockSources;

const aiActSourceIds: MockSourceId[] = [
  "eu-ai-act-2024-08-01",
  "eur-lex-ai-act-2024-1689"
];

export const mockTodayDailyDrops = [
  {
    id: "drop-2026-04-26-en",
    drop_date: "2026-04-26",
    language: "en",
    title: "Today's briefing",
    prompt_version: "daily_drop_mock_v1",
    generator_version: "manual_mock_v1",
    estimated_read_minutes: 5,
    items: {
      newsletter: [
        {
          id: "article-2026-04-26-en-ai-act",
          content_type: "newsletter_article",
          slot: "newsletter",
          language: "en",
          title: "The AI Act is turning into an operating calendar",
          topic: "tech_ai",
          published_date: "2026-04-26",
          summary:
            "Europe's AI law is no longer just a policy debate. It is becoming a timeline that product, legal, and engineering teams have to manage.",
          body_md:
            "The EU AI Act entered into force in 2024 and phases in obligations over time. The important shift is practical: teams now need to classify systems, document risk, and know which use cases are restricted before a product reaches users.\n\nFor a student building with AI, the lesson is simple. Regulation can shape the product roadmap as much as the model does. A strong AI idea still needs data discipline, user transparency, and a plan for compliance.",
          why_it_matters:
            "AI careers will reward people who understand both capability and constraint. The sharper question is not only what the model can do, but what the product is allowed to do safely.",
          source_ids: aiActSourceIds,
          version: 1
        },
        {
          id: "article-2026-04-26-en-usb-c",
          content_type: "newsletter_article",
          slot: "newsletter",
          language: "en",
          title: "USB-C shows how regulation can redesign a market",
          topic: "engineering",
          published_date: "2026-04-26",
          summary:
            "The EU common charger rule is a useful example of regulation changing product design, accessory economics, and customer expectations at once.",
          body_md:
            "The EU's common charger rules require many portable electronic devices sold in the bloc to use USB-C. Laptops follow on a later timeline. The policy goal is consumer convenience and lower electronic waste, but the business effect is wider.\n\nOnce an interface becomes standard, companies lose some control over accessory lock-in. They may gain simpler logistics, but they also face more comparable products and more price pressure in accessories.",
          why_it_matters:
            "Good operators watch standards. A small connector decision can affect margins, procurement, repair, and how customers judge a product ecosystem.",
          source_ids: ["eu-common-charger"],
          version: 1
        }
      ],
      business_story: {
        id: "business-story-2026-04-26-en-netflix",
        content_type: "business_story",
        slot: "business_story",
        language: "en",
        title: "Netflix turned password sharing into a pricing test",
        company_or_market: "Netflix",
        story_date: "2024-01-23",
        setup:
          "For years, Netflix tolerated account sharing because it helped the service spread. That habit also made the product feel cheaper than the official subscription price.",
        tension:
          "As streaming growth slowed, the company needed revenue growth without making the core product worse for paying households.",
        decision:
          "Netflix pushed paid sharing and asked extra households to either create their own account or pay for access through an existing one.",
        outcome:
          "In its Q4 2023 letter, Netflix reported stronger membership growth and framed paid sharing as part of a broader revenue plan, alongside ads and pricing work.",
        lesson:
          "Pricing power often hides in behavior the company has already trained. The hard part is converting that behavior without making loyal users feel punished.",
        source_ids: ["netflix-q4-2023-letter"],
        version: 1
      },
      mini_case: {
        id: "mini-case-2026-04-26-en-ai-notes",
        content_type: "mini_case",
        slot: "mini_case",
        language: "en",
        title: "Launch an AI study app without stepping into avoidable risk",
        topic: "tech_ai",
        difficulty: "intermediate",
        context:
          "You are the product lead for a campus app that turns lecture recordings into study notes. A European beta is planned in two weeks. The app uses AI to summarize audio, detect action items, and suggest flashcards. You have one engineer, no in-house lawyer, and a small group of pilot users.",
        challenge:
          "Recommend the three launch changes you would make before opening the beta.",
        constraints: [
          "Do not add more than one week of engineering work.",
          "Do not collect biometric or sensitive personal data.",
          "Keep the beta useful enough for students to test daily."
        ],
        question:
          "What would you change before launch, and what would you postpone?",
        expected_reasoning: [
          "Separate low-risk summarization from any feature that profiles students.",
          "Add clear user consent and recording notices before processing audio.",
          "Document data retention, model limitations, and human review paths.",
          "Postpone automated performance scoring until risk classification is clearer."
        ],
        sample_answer:
          "Ship summarization, flashcards, consent screens, and deletion controls. Remove any ranking or behavioral scoring from the beta. Write a one-page risk note that explains the data used, what the model does not decide, and who reviews user complaints.",
        source_ids: aiActSourceIds,
        version: 1
      },
      concept: {
        id: "concept-2026-04-26-en-switching-costs",
        content_type: "key_concept",
        slot: "concept",
        language: "en",
        title: "Switching costs",
        category: "business",
        definition:
          "Switching costs are the time, money, effort, risk, or lost convenience a user faces when moving from one product to another.",
        plain_english:
          "A product can keep customers not only because it is better, but because leaving feels annoying, expensive, or risky.",
        example:
          "A charger standard can lower switching costs by making accessories work across brands. A streaming account can raise switching costs when profiles, watch history, and household habits all sit in one service.",
        why_it_matters:
          "Switching costs explain why some businesses defend margins even when alternatives exist. They also explain why regulators care about interoperability.",
        how_to_use_it:
          "When analyzing a company, ask what the customer loses by leaving. Data, habits, contracts, integrations, and social connections are often more important than the headline feature.",
        common_mistake:
          "Do not confuse switching costs with loyalty. A trapped customer and a delighted customer behave differently when a cheaper escape appears.",
        source_ids: ["eu-common-charger", "netflix-q4-2023-letter"],
        version: 1
      }
    }
  },
  {
    id: "drop-2026-04-26-fr",
    drop_date: "2026-04-26",
    language: "fr",
    title: "Brief du jour",
    prompt_version: "daily_drop_mock_v1",
    generator_version: "manual_mock_v1",
    estimated_read_minutes: 5,
    items: {
      newsletter: [
        {
          id: "article-2026-04-26-fr-ai-act",
          content_type: "newsletter_article",
          slot: "newsletter",
          language: "fr",
          title: "L'AI Act devient un calendrier d'execution",
          topic: "tech_ai",
          published_date: "2026-04-26",
          summary:
            "La loi europeenne sur l'IA n'est plus seulement un debat politique. Elle devient un calendrier que les equipes produit, juridique et technique doivent suivre.",
          body_md:
            "L'AI Act europeen est entre en vigueur en 2024 et applique ses obligations par etapes. Le changement important est tres concret: les equipes doivent classer leurs systemes, documenter les risques et identifier les usages interdits ou encadres avant la mise en production.\n\nPour un etudiant qui construit avec l'IA, la lecon est claire. La regulation peut peser sur la feuille de route autant que le modele lui-meme. Une bonne idee IA a besoin de discipline sur les donnees, de transparence utilisateur et d'un plan de conformite.",
          why_it_matters:
            "Les carrieres dans l'IA recompenseront ceux qui comprennent la capacite technique et la contrainte. La bonne question n'est pas seulement ce que le modele peut faire, mais ce que le produit peut faire de maniere sure.",
          source_ids: aiActSourceIds,
          version: 1
        },
        {
          id: "article-2026-04-26-fr-usb-c",
          content_type: "newsletter_article",
          slot: "newsletter",
          language: "fr",
          title: "L'USB-C montre comment une regle peut remodeler un marche",
          topic: "engineering",
          published_date: "2026-04-26",
          summary:
            "La regle europeenne sur le chargeur commun montre comment une norme peut toucher le design produit, les accessoires et les attentes clients.",
          body_md:
            "Les regles europeennes sur le chargeur commun imposent l'USB-C a de nombreux appareils portables vendus dans l'Union. Les ordinateurs portables suivent un calendrier plus tardif. L'objectif public est simple: faciliter la vie des consommateurs et reduire les dechets electroniques. L'effet business est plus large.\n\nQuand une interface devient standard, les entreprises perdent une partie du controle sur les accessoires captifs. Elles peuvent simplifier leur logistique, mais leurs produits deviennent aussi plus comparables.",
          why_it_matters:
            "Un bon operateur regarde les standards. Un petit choix de connecteur peut modifier les marges, les achats, la reparation et la perception d'un ecosysteme.",
          source_ids: ["eu-common-charger"],
          version: 1
        }
      ],
      business_story: {
        id: "business-story-2026-04-26-fr-netflix",
        content_type: "business_story",
        slot: "business_story",
        language: "fr",
        title: "Netflix a transforme le partage de compte en test de pricing",
        company_or_market: "Netflix",
        story_date: "2024-01-23",
        setup:
          "Pendant des annees, Netflix a tolere le partage de comptes parce que cela aidait le service a se diffuser. Cette habitude rendait aussi l'abonnement officiel moins incontournable.",
        tension:
          "Quand la croissance du streaming a ralenti, l'entreprise devait augmenter ses revenus sans degrader le produit pour les foyers qui payaient deja.",
        decision:
          "Netflix a pousse le partage payant et demande aux foyers supplementaires de creer leur propre compte ou de payer un acces rattache a un compte existant.",
        outcome:
          "Dans sa lettre du T4 2023, Netflix a presente une forte croissance des abonnes et inscrit le partage payant dans une strategie de revenus plus large, avec la publicite et le pricing.",
        lesson:
          "Le pouvoir de prix se cache souvent dans un comportement deja installe. Le vrai defi consiste a le convertir sans donner aux bons clients l'impression d'etre punis.",
        source_ids: ["netflix-q4-2023-letter"],
        version: 1
      },
      mini_case: {
        id: "mini-case-2026-04-26-fr-ai-notes",
        content_type: "mini_case",
        slot: "mini_case",
        language: "fr",
        title: "Lancer une app IA de revision sans prendre un risque inutile",
        topic: "tech_ai",
        difficulty: "intermediate",
        context:
          "Tu es responsable produit d'une app campus qui transforme des enregistrements de cours en fiches de revision. Une beta europeenne est prevue dans deux semaines. L'app resume l'audio, extrait des actions et propose des flashcards. Tu as un ingenieur, pas de juriste interne et un petit groupe pilote.",
        challenge:
          "Recommande les trois changements a faire avant d'ouvrir la beta.",
        constraints: [
          "Ne pas ajouter plus d'une semaine de travail technique.",
          "Ne pas collecter de donnees biometriques ou sensibles.",
          "Garder une beta assez utile pour etre testee chaque jour."
        ],
        question:
          "Que changes-tu avant le lancement, et que repousses-tu ?",
        expected_reasoning: [
          "Separer le resume a faible risque de toute fonctionnalite qui profilerait les etudiants.",
          "Ajouter un consentement clair et des notices avant le traitement audio.",
          "Documenter la retention des donnees, les limites du modele et les recours humains.",
          "Repousser le scoring automatique de performance tant que la classification du risque n'est pas claire."
        ],
        sample_answer:
          "Je lance le resume, les flashcards, les ecrans de consentement et les controles de suppression. Je retire tout classement ou scoring comportemental de la beta. Je redige une note risque d'une page qui explique les donnees utilisees, ce que le modele ne decide pas, et qui traite les retours utilisateurs.",
        source_ids: aiActSourceIds,
        version: 1
      },
      concept: {
        id: "concept-2026-04-26-fr-switching-costs",
        content_type: "key_concept",
        slot: "concept",
        language: "fr",
        title: "Couts de changement",
        category: "business",
        definition:
          "Les couts de changement regroupent le temps, l'argent, l'effort, le risque ou la perte de confort qu'un utilisateur subit quand il passe d'un produit a un autre.",
        plain_english:
          "Un produit peut garder ses clients non seulement parce qu'il est meilleur, mais parce que partir semble penible, cher ou risque.",
        example:
          "Un standard de chargeur peut reduire ces couts en rendant les accessoires compatibles entre marques. Un compte de streaming peut les augmenter quand profils, historique et habitudes du foyer restent dans un seul service.",
        why_it_matters:
          "Ce concept explique pourquoi certaines entreprises protegent leurs marges meme avec des alternatives sur le marche. Il explique aussi pourquoi les regulateurs s'interessent a l'interoperabilite.",
        how_to_use_it:
          "Quand tu analyses une entreprise, demande ce que le client perd en partant. Les donnees, les habitudes, les contrats, les integrations et les liens sociaux comptent souvent plus que la fonctionnalite principale.",
        common_mistake:
          "Ne confonds pas cout de changement et fidelite. Un client bloque et un client ravi ne reagissent pas pareil quand une sortie moins chere apparait.",
        source_ids: ["eu-common-charger", "netflix-q4-2023-letter"],
        version: 1
      }
    }
  }
] satisfies TodayDailyDrop[];

export const mockTodayDailyDropsByLanguage = mockTodayDailyDrops.reduce(
  (dropsByLanguage, drop) => ({
    ...dropsByLanguage,
    [drop.language]: drop
  }),
  {} as Record<ContentLanguage, TodayDailyDrop>
);

export function flattenDailyDropItems(
  drop: TodayDailyDrop
): DailyDropContentItem[] {
  return [
    ...drop.items.newsletter,
    drop.items.business_story,
    drop.items.mini_case,
    drop.items.concept
  ];
}

export function getMockSourcesForItem(item: {
  source_ids: string[];
}): SourceMetadata[] {
  return item.source_ids
    .filter(isMockSourceId)
    .map((sourceId) => mockSources[sourceId]);
}

function isMockSourceId(sourceId: string): sourceId is MockSourceId {
  return Object.prototype.hasOwnProperty.call(mockSources, sourceId);
}

export function getTopicsForDrop(drop: TodayDailyDrop): TopicId[] {
  const topics = flattenDailyDropItems(drop).flatMap((item) => {
    if ("topic" in item) {
      return [item.topic];
    }

    if ("category" in item && item.category !== "career") {
      return [item.category];
    }

    return [];
  });

  return [...new Set(topics)];
}
