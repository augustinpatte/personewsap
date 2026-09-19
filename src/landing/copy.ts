/**
 * Every visible string on the landing page, in both languages.
 *
 * Kept out of LanguageContext's key/value dictionary for the same reason as
 * legalCopy: this is structured prose, and holding EN and FR side by side in
 * one typed object is what lets a test prove parity instead of an eye.
 *
 * Rules for this file:
 * - Describe the product as built: four editions a week (Mon/Wed/Fri + a
 *   Sunday digest), 1–3 articles per topic, Business Stories, Mini Cases,
 *   questions with a 20-second timer scored on reasoning, private Teams.
 * - The apps are not in the stores yet. Nothing here may suggest a download.
 * - Every example (headlines, readers, scores) is illustrative and says so on
 *   the page. No metrics, no testimonials, no user counts.
 */

export type LandingLanguage = "en" | "fr";

export const TOPIC_IDS = [
  "business",
  "finance",
  "tech_ai",
  "law",
  "medicine",
  "engineering",
  "sport_business",
  "culture_media",
] as const;

export type TopicId = (typeof TOPIC_IDS)[number];

type TopicCopy = {
  name: string;
  /** What the topic covers, in a few words. */
  scope: string;
  /** An illustrative, evergreen explainer headline. */
  headline: string;
  /** One line under the headline, the "why it matters". */
  why: string;
};

type Option = { label: string; text: string };

export type LandingCopy = {
  meta: { title: string; description: string };
  a11y: { skip: string; home: string; mainNav: string; openMenu: string; closeMenu: string; language: string };
  nav: { product: string; how: string; topics: string; about: string; cta: string };
  stores: {
    comingSoon: string;
    appStore: string;
    googlePlay: string;
    appStoreLabel: string;
    googlePlayLabel: string;
  };
  illustrative: string;
  app: {
    tabs: { newsletter: string; cases: string; stories: string; path: string; teams: string };
    editionEyebrow: string;
    editionTitle: string;
    progress: string;
    minutes: (n: number) => string;
    whyLabel: string;
    storyEyebrow: string;
    caseEyebrow: string;
    questionEyebrow: (n: number, total: number) => string;
    seconds: (n: number) => string;
    points: (value: string) => string;
  };
  hero: {
    eyebrow: string;
    titleLead: string;
    titleTail: string;
    lede: string;
    availability: string;
    visualLabel: string;
  };
  product: {
    eyebrow: string;
    title: string;
    lede: string;
    news: { label: string; title: string; body: string };
    story: { label: string; title: string; body: string };
    cases: { label: string; title: string; body: string };
    test: { label: string; title: string; body: string };
  };
  story: {
    company: string;
    title: string;
    chapters: string[];
    activeChapter: number;
    body: string;
    lessonLabel: string;
    lesson: string;
  };
  miniCase: {
    title: string;
    context: string;
    prompt: string;
    options: Option[];
    chosen: number;
    verdict: string;
    feedback: string;
  };
  question: {
    prompt: string;
    options: Option[];
    chosen: number;
    verdict: string;
    explanation: string;
  };
  howItWorks: {
    eyebrow: string;
    titleLead: string;
    titleTail: string;
    lede: string;
    ringCenter: string;
    ringCaption: string;
    ringLabel: string;
    parts: { title: string; body: string }[];
    weekTitle: string;
    weekLede: string;
    days: string[];
    edition: string;
    digest: string;
    rest: string;
    read: string;
    today: string;
    weekNote: string;
  };
  topics: {
    eyebrow: string;
    title: string;
    lede: string;
    pickerLabel: string;
    selected: (n: number) => string;
    previewTitle: string;
    previewHint: string;
    previewEmpty: string;
    list: Record<TopicId, TopicCopy>;
  };
  personalization: {
    eyebrow: string;
    title: string;
    lede: string;
    readerA: string;
    readerB: string;
    topicsLabel: string;
    feedLabel: string;
    compositionLabel: string;
    articles: (n: number) => string;
    note: string;
  };
  engage: {
    eyebrow: string;
    title: string;
    lede: string;
    steps: { title: string; body: string }[];
    scoring: {
      title: string;
      body: string;
      tiers: { value: string; name: string; body: string }[];
    };
    teams: {
      tag: string;
      title: string;
      body: string;
      boardTitle: string;
      you: string;
      caption: string;
    };
  };
  mission: {
    eyebrow: string;
    titleLead: string;
    titleTail: string;
    paragraphs: string[];
    principles: { title: string; body: string }[];
  };
  download: {
    eyebrow: string;
    title: string;
    lede: string;
    note: string;
  };
  footer: {
    tagline: string;
    productHeading: string;
    legalHeading: string;
    privacy: string;
    support: string;
    /** What a screen reader says for the footer's mailto link. */
    contactLabel: (email: string) => string;
    deleteAccount: string;
    subscribers: string;
    language: string;
    rights: (year: number) => string;
  };
};

export const landingCopy: Record<LandingLanguage, LandingCopy> = {
  en: {
    meta: {
      title: "PersoNewsAP — Know what matters. Understand why.",
      description:
        "PersoNewsAP is a mobile app that explains the news on the topics you choose, with business stories, mini cases and questions to test what you understood. Coming soon on iPhone and Android.",
    },
    a11y: {
      skip: "Skip to content",
      home: "PersoNewsAP, home",
      mainNav: "Main navigation",
      openMenu: "Open menu",
      closeMenu: "Close menu",
      language: "Language",
    },
    nav: {
      product: "Product",
      how: "How it works",
      topics: "Topics",
      about: "About",
      cta: "Coming soon",
    },
    stores: {
      comingSoon: "Coming soon",
      appStore: "App Store",
      googlePlay: "Google Play",
      appStoreLabel: "Coming soon on the App Store. Not available to download yet.",
      googlePlayLabel: "Coming soon on Google Play. Not available to download yet.",
    },
    illustrative: "Illustrative example",
    app: {
      tabs: {
        newsletter: "Newsletter",
        cases: "Mini cases",
        stories: "Stories",
        path: "Path",
        teams: "Teams",
      },
      editionEyebrow: "Wednesday edition",
      editionTitle: "Your edition",
      progress: "2 of 4",
      minutes: (n) => `${n} min`,
      whyLabel: "Why it matters",
      storyEyebrow: "Business Story",
      caseEyebrow: "Mini Case",
      questionEyebrow: (n, total) => `Question ${n} of ${total}`,
      seconds: (n) => `${n} s`,
      points: (value) => `${value} pt`,
    },
    hero: {
      eyebrow: "The PersoNewsAP app",
      titleLead: "Know what matters.",
      titleTail: "Understand why.",
      lede:
        "Pick your topics. Get short editions that explain what happened and why it matters, then answer a few questions to check you really got it.",
      availability: "Coming soon on iPhone and Android.",
      visualLabel:
        "Two screens from the PersoNewsAP app: a personalized edition with news on finance, business and tech, and a mini case asking the reader to make a decision.",
    },
    product: {
      eyebrow: "What's inside",
      title: "Four formats. One short edition.",
      lede: "Each edition mixes what is happening with why it happens, and asks you to think about it.",
      news: {
        label: "Your news",
        title: "The news on your topics, explained",
        body: "One to three articles per topic you follow. Each one says what happened and why it matters.",
      },
      story: {
        label: "Business Stories",
        title: "How companies really work",
        body: "Short stories about companies, markets and decisions, from the setup to the lesson worth keeping.",
      },
      cases: {
        label: "Mini Cases",
        title: "Your turn to decide",
        body: "A real-world situation, a decision to make, and feedback on the reasoning behind each choice.",
      },
      test: {
        label: "Test yourself",
        title: "Questions that check you got it",
        body: "A few questions at the end of what you read. Twenty seconds each, scored on how well you reasoned.",
      },
    },
    story: {
      company: "Retail",
      title: "Why Costco's real product is the membership card",
      chapters: ["Setup", "Tension", "Decision", "Outcome", "Lesson"],
      activeChapter: 2,
      body:
        "Costco keeps its prices close to cost on purpose. The margin it gives up on the shelf, it earns back at the door: members pay every year for the right to shop there.",
      lessonLabel: "Lesson",
      lesson: "When the product barely makes money, the business model can live somewhere else.",
    },
    miniCase: {
      title: "Coffee costs just jumped",
      context:
        "You run a chain of twelve cafés. Your supplier raises the price of beans sharply, and your margin on every cup shrinks.",
      prompt: "What do you do first?",
      options: [
        { label: "A", text: "Raise every price by the same amount" },
        { label: "B", text: "Raise prices where customers care least about price" },
        { label: "C", text: "Quietly make the cups smaller" },
        { label: "D", text: "Absorb the cost and wait" },
      ],
      chosen: 1,
      verdict: "Excellent",
      feedback: "You protect your margin where demand holds, without testing every customer's loyalty at once.",
    },
    question: {
      prompt: "Why can Costco afford to keep its product margins so low?",
      options: [
        { label: "A", text: "Its suppliers are paid less than elsewhere" },
        { label: "B", text: "Membership fees carry a large part of its profit" },
        { label: "C", text: "It sells mostly premium products" },
      ],
      chosen: 1,
      verdict: "Excellent",
      explanation: "The fee is paid up front, every year. It is what makes low prices sustainable.",
    },
    howItWorks: {
      eyebrow: "How it works",
      titleLead: "About five minutes.",
      titleTail: "Then you're done.",
      lede:
        "An edition has a beginning and an end. No infinite feed, no autoplay. You read, you answer, you close the app knowing more than when you opened it.",
      ringCenter: "≈ 5 min",
      ringCaption: "one edition",
      ringLabel: "An edition in four parts. In this example, two parts are done.",
      parts: [
        { title: "Your news", body: "What happened on your topics, and why it matters." },
        { title: "A Business Story", body: "One company or market, explained through a decision." },
        { title: "A Mini Case", body: "A situation where you make the call." },
        { title: "Questions", body: "A few quick questions to lock in what you read." },
      ],
      weekTitle: "Four editions a week",
      weekLede: "Monday, Wednesday and Friday, plus a digest on Sunday. The other days are yours.",
      days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      edition: "Edition",
      digest: "Weekly digest",
      rest: "No edition",
      read: "Read",
      today: "Today",
      weekNote: "A reading week, as an example.",
    },
    topics: {
      eyebrow: "Topics",
      title: "Your edition starts with your topics",
      lede: "Choose what you want to understand better. Your edition follows. Try it:",
      pickerLabel: "Choose topics for this preview",
      selected: (n) => (n === 1 ? "1 topic selected" : `${n} topics selected`),
      previewTitle: "Your edition, previewed",
      previewHint: "Headlines are examples of the kind of explainer you get.",
      previewEmpty: "Pick at least one topic to see your edition.",
      list: {
        business: {
          name: "Business",
          scope: "Companies, strategy, markets",
          headline: "Why some brands raise prices and keep their customers",
          why: "Pricing power is one of the clearest signs of a strong business.",
        },
        finance: {
          name: "Finance",
          scope: "Rates, markets, economy",
          headline: "What a rate decision actually changes for companies",
          why: "The cost of money shapes who can invest, hire and grow.",
        },
        tech_ai: {
          name: "Tech & AI",
          scope: "AI, platforms, chips",
          headline: "Why AI is expensive to run, not just to build",
          why: "Every answer a model gives has a cost, and someone has to pay it.",
        },
        law: {
          name: "Law",
          scope: "Rulings, regulation, rights",
          headline: "How a competition ruling can reshape a whole market",
          why: "Some court decisions move more money than any product launch.",
        },
        medicine: {
          name: "Medicine",
          scope: "Research, health systems",
          headline: "What a phase III trial proves, and what it doesn't",
          why: "Reading a study result correctly avoids most health myths.",
        },
        engineering: {
          name: "Engineering",
          scope: "Energy, industry, infrastructure",
          headline: "What it takes to connect a new power plant to the grid",
          why: "The bottleneck is often the cable, not the plant.",
        },
        sport_business: {
          name: "Sports Business",
          scope: "Clubs, rights, leagues",
          headline: "How broadcasting rights fund modern football",
          why: "The TV contract, not the ticket office, pays for most squads.",
        },
        culture_media: {
          name: "Culture & Media",
          scope: "Streaming, publishing, creators",
          headline: "Why streaming platforms are bringing ads back",
          why: "Subscriptions alone rarely cover the cost of what we watch.",
        },
      },
    },
    personalization: {
      eyebrow: "Personal",
      title: "Same day. Two different editions.",
      lede: "Two readers open PersoNewsAP on the same morning. Each gets the news on their own topics.",
      readerA: "Reader A",
      readerB: "Reader B",
      topicsLabel: "Follows:",
      feedLabel: "Their news today",
      compositionLabel: "Articles per topic",
      articles: (n) => (n === 1 ? "1 article" : `${n} articles`),
      note: "Readers and headlines shown are examples.",
    },
    engage: {
      eyebrow: "Active, not passive",
      title: "Don't just read it. Use it.",
      lede: "Understanding sticks when you have to do something with it. So each edition asks you to.",
      steps: [
        { title: "Read", body: "A short, sourced explanation." },
        { title: "Answer", body: "Questions at the end, 20 seconds each." },
        { title: "Choose", body: "Make the call in a Mini Case." },
        { title: "Compare", body: "See the reasoning behind every option." },
        { title: "Learn", body: "Keep the principle, not just the fact." },
      ],
      scoring: {
        title: "Not just right or wrong",
        body: "Every answer can be defended. Each one earns part of the point, depending on how well it holds up.",
        tiers: [
          { value: "1", name: "Excellent", body: "The complete answer, with the strongest reasoning." },
          { value: "0.6", name: "Good", body: "Sound logic, but something important is missing." },
          { value: "0.3", name: "Partial", body: "Part of the reasoning is right." },
          { value: "0", name: "Miss", body: "The main reasoning does not hold." },
        ],
      },
      teams: {
        tag: "With friends · at launch",
        title: "Private Teams",
        body:
          "Create a private Team with friends or classmates, answer the same questions and compare how you reasoned. Your answer counts once, for you and for your Team.",
        boardTitle: "This week",
        you: "You",
        caption: "Names and scores are examples.",
      },
    },
    mission: {
      eyebrow: "Why PersoNewsAP",
      titleLead: "Less scrolling.",
      titleTail: "More understanding.",
      paragraphs: [
        "PersoNewsAP isn't built to keep you on your phone. It's built to help you understand more of what matters, without spending hours in a feed.",
        "Each edition brings together what is happening, why it happens, and a way to check you understood. Then it ends, and you get on with your day.",
      ],
      principles: [
        { title: "Editions that end", body: "A finite edition, four times a week. Past editions stay in your library." },
        { title: "Explained and sourced", body: "Context before opinion, with the sources behind each piece." },
        { title: "Active by design", body: "Questions and decisions, so what you read actually stays." },
      ],
    },
    download: {
      eyebrow: "iOS & Android",
      title: "Coming soon on iPhone and Android",
      lede: "PersoNewsAP is getting ready for the App Store and Google Play, in English and in French.",
      note: "The apps are not available to download yet. Official store links will appear here on launch day.",
    },
    footer: {
      tagline: "The news on your topics, explained in a few minutes, with questions to make it stick.",
      productHeading: "On this page",
      legalHeading: "Legal & help",
      privacy: "Privacy",
      support: "Support",
      contactLabel: (email) => `Contact: ${email}`,
      deleteAccount: "Delete account",
      subscribers: "Email subscribers: manage preferences",
      language: "Language",
      rights: (year) => `© ${year} PersoNewsAP`,
    },
  },

  fr: {
    meta: {
      title: "PersoNewsAP — Savoir ce qui compte. Comprendre pourquoi.",
      description:
        "PersoNewsAP est une application mobile qui explique l'actualité des sujets que vous choisissez, avec des business stories, des mini cas et des questions pour vérifier ce que vous avez compris. Bientôt sur iPhone et Android.",
    },
    a11y: {
      skip: "Aller au contenu",
      home: "PersoNewsAP, accueil",
      mainNav: "Navigation principale",
      openMenu: "Ouvrir le menu",
      closeMenu: "Fermer le menu",
      language: "Langue",
    },
    nav: {
      product: "Produit",
      how: "Comment ça marche",
      topics: "Sujets",
      about: "À propos",
      cta: "Bientôt disponible",
    },
    stores: {
      comingSoon: "Bientôt sur",
      appStore: "App Store",
      googlePlay: "Google Play",
      appStoreLabel: "Bientôt sur l'App Store. Pas encore disponible au téléchargement.",
      googlePlayLabel: "Bientôt sur Google Play. Pas encore disponible au téléchargement.",
    },
    illustrative: "Exemple illustratif",
    app: {
      tabs: {
        newsletter: "Newsletter",
        cases: "Mini cas",
        stories: "Stories",
        path: "Parcours",
        teams: "Teams",
      },
      editionEyebrow: "Édition du mercredi",
      editionTitle: "Votre édition",
      progress: "2 sur 4",
      minutes: (n) => `${n} min`,
      whyLabel: "Pourquoi c'est important",
      storyEyebrow: "Business Story",
      caseEyebrow: "Mini cas",
      questionEyebrow: (n, total) => `Question ${n} sur ${total}`,
      seconds: (n) => `${n} s`,
      points: (value) => `${value.replace(".", ",")} pt`,
    },
    hero: {
      eyebrow: "L'application PersoNewsAP",
      titleLead: "Savoir ce qui compte.",
      titleTail: "Comprendre pourquoi.",
      lede:
        "Choisissez vos sujets. Recevez des éditions courtes qui expliquent ce qui s'est passé et pourquoi c'est important, puis répondez à quelques questions pour vérifier que vous avez vraiment compris.",
      availability: "Bientôt sur iPhone et Android.",
      visualLabel:
        "Deux écrans de l'application PersoNewsAP : une édition personnalisée avec de l'actualité finance, business et tech, et un mini cas qui demande au lecteur de prendre une décision.",
    },
    product: {
      eyebrow: "Au programme",
      title: "Quatre formats. Une édition courte.",
      lede: "Chaque édition mêle ce qui se passe et pourquoi ça se passe, et vous demande d'y réfléchir.",
      news: {
        label: "Votre actualité",
        title: "L'actualité de vos sujets, expliquée",
        body: "Un à trois articles par sujet suivi. Chacun dit ce qui s'est passé et pourquoi c'est important.",
      },
      story: {
        label: "Business Stories",
        title: "Comment les entreprises fonctionnent vraiment",
        body: "De courtes histoires d'entreprises, de marchés et de décisions, du contexte jusqu'à la leçon à retenir.",
      },
      cases: {
        label: "Mini cas",
        title: "À vous de décider",
        body: "Une situation concrète, une décision à prendre, et un retour sur le raisonnement derrière chaque choix.",
      },
      test: {
        label: "Testez-vous",
        title: "Des questions pour vérifier",
        body: "Quelques questions après votre lecture. Vingt secondes chacune, notées sur la qualité du raisonnement.",
      },
    },
    story: {
      company: "Distribution",
      title: "Pourquoi le vrai produit de Costco, c'est la carte de membre",
      chapters: ["Contexte", "Tension", "Décision", "Résultat", "Leçon"],
      activeChapter: 2,
      body:
        "Costco vend volontairement au plus près du prix coûtant. La marge qu'il abandonne en rayon, il la récupère à l'entrée : chaque année, ses membres paient pour avoir le droit d'y faire leurs courses.",
      lessonLabel: "Leçon",
      lesson: "Quand le produit rapporte peu, le modèle économique peut se trouver ailleurs.",
    },
    miniCase: {
      title: "Le prix du café vient de bondir",
      context:
        "Vous dirigez une chaîne de douze cafés. Votre fournisseur augmente fortement le prix des grains, et votre marge fond sur chaque tasse.",
      prompt: "Que faites-vous en premier ?",
      options: [
        { label: "A", text: "Augmenter tous les prix du même montant" },
        { label: "B", text: "Augmenter là où les clients regardent le moins le prix" },
        { label: "C", text: "Réduire discrètement la taille des tasses" },
        { label: "D", text: "Absorber la hausse et attendre" },
      ],
      chosen: 1,
      verdict: "Excellent",
      feedback: "Vous protégez votre marge là où la demande tient, sans mettre à l'épreuve la fidélité de tous vos clients.",
    },
    question: {
      prompt: "Pourquoi Costco peut-il se permettre des marges aussi faibles sur ses produits ?",
      options: [
        { label: "A", text: "Ses fournisseurs sont moins payés qu'ailleurs" },
        { label: "B", text: "Les cotisations portent une grande partie de son bénéfice" },
        { label: "C", text: "Il vend surtout des produits haut de gamme" },
      ],
      chosen: 1,
      verdict: "Excellent",
      explanation: "La cotisation est payée d'avance, chaque année. C'est elle qui rend les prix bas tenables.",
    },
    howItWorks: {
      eyebrow: "Comment ça marche",
      titleLead: "Environ cinq minutes.",
      titleTail: "Et c'est terminé.",
      lede:
        "Une édition a un début et une fin. Pas de fil infini, pas de lecture automatique. Vous lisez, vous répondez, et vous refermez l'application en en sachant plus qu'en l'ouvrant.",
      ringCenter: "≈ 5 min",
      ringCaption: "une édition",
      ringLabel: "Une édition en quatre parties. Dans cet exemple, deux parties sont terminées.",
      parts: [
        { title: "Votre actualité", body: "Ce qui s'est passé sur vos sujets, et pourquoi c'est important." },
        { title: "Une Business Story", body: "Une entreprise ou un marché, expliqué à travers une décision." },
        { title: "Un mini cas", body: "Une situation où c'est vous qui tranchez." },
        { title: "Des questions", body: "Quelques questions rapides pour ancrer ce que vous avez lu." },
      ],
      weekTitle: "Quatre éditions par semaine",
      weekLede: "Lundi, mercredi et vendredi, plus un récapitulatif le dimanche. Les autres jours sont à vous.",
      days: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
      edition: "Édition",
      digest: "Récap de la semaine",
      rest: "Pas d'édition",
      read: "Lue",
      today: "Aujourd'hui",
      weekNote: "Une semaine de lecture, à titre d'exemple.",
    },
    topics: {
      eyebrow: "Sujets",
      title: "Votre édition commence par vos sujets",
      lede: "Choisissez ce que vous voulez mieux comprendre. Votre édition suit. Essayez :",
      pickerLabel: "Choisissez des sujets pour cet aperçu",
      selected: (n) => (n <= 1 ? `${n} sujet sélectionné` : `${n} sujets sélectionnés`),
      previewTitle: "Aperçu de votre édition",
      previewHint: "Les titres sont des exemples du type d'explications que vous recevez.",
      previewEmpty: "Choisissez au moins un sujet pour voir votre édition.",
      list: {
        business: {
          name: "Business",
          scope: "Entreprises, stratégie, marchés",
          headline: "Pourquoi certaines marques augmentent leurs prix sans perdre leurs clients",
          why: "Le pouvoir de fixer ses prix est l'un des meilleurs signes d'une entreprise solide.",
        },
        finance: {
          name: "Finance",
          scope: "Taux, marchés, économie",
          headline: "Ce qu'une décision de taux change vraiment pour les entreprises",
          why: "Le prix de l'argent décide qui peut investir, recruter et grandir.",
        },
        tech_ai: {
          name: "Tech & IA",
          scope: "IA, plateformes, puces",
          headline: "Pourquoi l'IA coûte cher à faire tourner, pas seulement à construire",
          why: "Chaque réponse d'un modèle a un coût, et quelqu'un doit le payer.",
        },
        law: {
          name: "Droit",
          scope: "Décisions, régulation, droits",
          headline: "Comment une décision de concurrence peut redessiner tout un marché",
          why: "Certaines décisions de justice déplacent plus d'argent qu'un lancement de produit.",
        },
        medicine: {
          name: "Médecine",
          scope: "Recherche, systèmes de santé",
          headline: "Ce qu'un essai de phase III prouve, et ce qu'il ne prouve pas",
          why: "Bien lire un résultat d'étude évite la plupart des idées reçues en santé.",
        },
        engineering: {
          name: "Ingénierie",
          scope: "Énergie, industrie, infrastructures",
          headline: "Ce qu'il faut pour raccorder une nouvelle centrale au réseau",
          why: "Le goulot d'étranglement, c'est souvent le câble, pas la centrale.",
        },
        sport_business: {
          name: "Business du sport",
          scope: "Clubs, droits TV, ligues",
          headline: "Comment les droits TV financent le football moderne",
          why: "C'est le contrat télé, pas la billetterie, qui paie la plupart des effectifs.",
        },
        culture_media: {
          name: "Culture & médias",
          scope: "Streaming, édition, créateurs",
          headline: "Pourquoi les plateformes de streaming reviennent à la publicité",
          why: "L'abonnement seul couvre rarement le coût de ce que nous regardons.",
        },
      },
    },
    personalization: {
      eyebrow: "Personnel",
      title: "Le même jour. Deux éditions différentes.",
      lede: "Deux lecteurs ouvrent PersoNewsAP le même matin. Chacun reçoit l'actualité de ses propres sujets.",
      readerA: "Profil A",
      readerB: "Profil B",
      topicsLabel: "Suit :",
      feedLabel: "Son actualité du jour",
      compositionLabel: "Articles par sujet",
      articles: (n) => (n <= 1 ? `${n} article` : `${n} articles`),
      note: "Les profils et les titres présentés sont des exemples.",
    },
    engage: {
      eyebrow: "Actif, pas passif",
      title: "Ne vous contentez pas de lire.",
      lede: "On retient ce qu'on doit utiliser. Alors chaque édition vous demande d'en faire quelque chose.",
      steps: [
        { title: "Lire", body: "Une explication courte et sourcée." },
        { title: "Répondre", body: "Des questions à la fin, 20 secondes chacune." },
        { title: "Choisir", body: "Trancher dans un mini cas." },
        { title: "Comparer", body: "Voir le raisonnement derrière chaque option." },
        { title: "Retenir", body: "Garder le principe, pas seulement le fait." },
      ],
      scoring: {
        title: "Pas seulement juste ou faux",
        body: "Chaque réponse peut se défendre. Chacune rapporte une part du point, selon la solidité de son raisonnement.",
        tiers: [
          { value: "1", name: "Excellent", body: "La réponse complète, avec le raisonnement le plus solide." },
          { value: "0,6", name: "Bien", body: "Une logique juste, mais il manque un élément important." },
          { value: "0,3", name: "Partiel", body: "Une partie du raisonnement est juste." },
          { value: "0", name: "Raté", body: "Le raisonnement principal ne tient pas." },
        ],
      },
      teams: {
        tag: "Entre amis · au lancement",
        title: "Des Teams privées",
        body:
          "Créez une Team privée avec vos amis ou votre promo, répondez aux mêmes questions et comparez vos raisonnements. Votre réponse compte une seule fois, pour vous et pour votre Team.",
        boardTitle: "Cette semaine",
        you: "Vous",
        caption: "Noms et scores donnés à titre d'exemple.",
      },
    },
    mission: {
      eyebrow: "Pourquoi PersoNewsAP",
      titleLead: "Moins de scroll.",
      titleTail: "Plus de compréhension.",
      paragraphs: [
        "PersoNewsAP n'est pas conçu pour vous garder sur votre téléphone. Il est conçu pour vous aider à comprendre davantage ce qui compte, sans passer des heures dans un fil d'actualité.",
        "Chaque édition réunit ce qui se passe, pourquoi ça se passe, et un moyen de vérifier que vous avez compris. Puis elle se termine, et vous passez à autre chose.",
      ],
      principles: [
        { title: "Des éditions qui se terminent", body: "Une édition finie, quatre fois par semaine. Les anciennes restent dans votre bibliothèque." },
        { title: "Expliqué et sourcé", body: "Le contexte avant l'opinion, avec les sources de chaque contenu." },
        { title: "Actif par conception", body: "Des questions et des décisions, pour que ce que vous lisez reste." },
      ],
    },
    download: {
      eyebrow: "iOS et Android",
      title: "Bientôt sur iPhone et Android",
      lede: "PersoNewsAP se prépare pour l'App Store et Google Play, en français et en anglais.",
      note: "Les applications ne sont pas encore téléchargeables. Les liens officiels apparaîtront ici le jour du lancement.",
    },
    footer: {
      tagline: "L'actualité de vos sujets, expliquée en quelques minutes, avec des questions pour la retenir.",
      productHeading: "Sur cette page",
      legalHeading: "Légal et aide",
      privacy: "Confidentialité",
      support: "Assistance",
      contactLabel: (email) => `Contact : ${email}`,
      deleteAccount: "Supprimer le compte",
      subscribers: "Abonnés e-mail : gérer vos préférences",
      language: "Langue",
      rights: (year) => `© ${year} PersoNewsAP`,
    },
  },
};
