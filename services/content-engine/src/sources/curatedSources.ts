import type { TopicId } from "../domain.js";
import type { CuratedSource, SourceRegion } from "./types.js";

type CuratedSourceDefinition = Omit<CuratedSource, "region"> & {
  region?: SourceRegion;
};

const CURATED_SOURCE_DEFINITIONS: CuratedSourceDefinition[] = [
  {
    id: "bbc-business",
    topic: "business",
    language: "en",
    publisher: "BBC News",
    url: "https://www.bbc.com/business",
    rssUrl: "https://feeds.bbci.co.uk/news/business/rss.xml",
    credibility_score: 0.9,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Broad business and economy reporting."
  },
  {
    id: "npr-business",
    topic: "business",
    language: "en",
    publisher: "NPR",
    url: "https://www.npr.org/sections/business/",
    rssUrl: "https://feeds.npr.org/1006/rss.xml",
    credibility_score: 0.86,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Business reporting with accessible policy and labor context."
  },
  {
    id: "hbr",
    topic: "business",
    language: "en",
    publisher: "Harvard Business Review",
    url: "https://hbr.org/",
    rssUrl: "https://hbr.org/feed",
    credibility_score: 0.82,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Management, strategy, leadership, and organizational behavior."
  },
  {
    id: "mit-business-management",
    topic: "business",
    language: "en",
    publisher: "MIT News",
    url: "https://news.mit.edu/topic/business",
    rssUrl: "https://news.mit.edu/rss/topic/business",
    credibility_score: 0.88,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "University research and entrepreneurship updates with strong student relevance."
  },
  {
    id: "knowledge-at-wharton",
    topic: "business",
    language: "en",
    publisher: "Knowledge at Wharton",
    region: "us",
    url: "https://knowledge.wharton.upenn.edu/",
    rssUrl: "https://knowledge.wharton.upenn.edu/feed/",
    credibility_score: 0.82,
    credibility_tier: "tier_2",
    source_type: "institutional_site",
    description: "Business school research, management, markets, and leadership explainers."
  },
  {
    id: "the-conversation-business",
    topic: "business",
    language: "en",
    publisher: "The Conversation",
    region: "global",
    url: "https://theconversation.com/us/business",
    rssUrl: "https://theconversation.com/us/business/articles.atom",
    credibility_score: 0.78,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Expert-written business and economy analysis with university author attribution."
  },
  {
    id: "federal-reserve-press",
    topic: "finance",
    language: "en",
    publisher: "Federal Reserve",
    url: "https://www.federalreserve.gov/newsevents/pressreleases.htm",
    rssUrl: "https://www.federalreserve.gov/feeds/press_all.xml",
    credibility_score: 0.95,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Primary-source monetary policy, supervision, and financial system updates."
  },
  {
    id: "sec-press",
    topic: "finance",
    language: "en",
    publisher: "U.S. Securities and Exchange Commission",
    url: "https://www.sec.gov/newsroom/press-releases",
    rssUrl: "https://www.sec.gov/news/pressreleases.rss",
    credibility_score: 0.94,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Primary-source securities enforcement and market regulation updates."
  },
  {
    id: "marketplace",
    topic: "finance",
    language: "en",
    publisher: "Marketplace",
    url: "https://www.marketplace.org/",
    rssUrl: "https://www.marketplace.org/feed/",
    credibility_score: 0.8,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Economic news explained for a broad audience."
  },
  {
    id: "ecb-press",
    topic: "finance",
    language: "en",
    publisher: "European Central Bank",
    url: "https://www.ecb.europa.eu/press/",
    rssUrl: "https://www.ecb.europa.eu/rss/press.html",
    credibility_score: 0.95,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "Primary-source European monetary policy, speeches, interviews, and press releases."
  },
  {
    id: "bis-press",
    topic: "finance",
    language: "en",
    publisher: "Bank for International Settlements",
    region: "global",
    url: "https://www.bis.org/press/",
    rssUrl: "https://www.bis.org/list/press_releases/index.rss",
    credibility_score: 0.93,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "Primary-source central banking, financial stability, and market infrastructure updates."
  },
  {
    id: "cftc-press",
    topic: "finance",
    language: "en",
    publisher: "U.S. Commodity Futures Trading Commission",
    region: "us",
    url: "https://www.cftc.gov/PressRoom/PressReleases",
    rssUrl: "https://www.cftc.gov/RSS/PressReleases.xml",
    credibility_score: 0.92,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "Primary-source derivatives, commodities, market integrity, and enforcement updates."
  },
  {
    id: "mit-tech-review",
    topic: "tech_ai",
    language: "en",
    publisher: "MIT Technology Review",
    url: "https://www.technologyreview.com/",
    rssUrl: "https://www.technologyreview.com/feed/",
    credibility_score: 0.9,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Technology and AI reporting with research and industry context."
  },
  {
    id: "google-ai-blog",
    topic: "tech_ai",
    language: "en",
    publisher: "Google AI Blog",
    url: "https://blog.google/technology/ai/",
    rssUrl: "https://blog.google/technology/ai/rss/",
    credibility_score: 0.78,
    credibility_tier: "tier_2",
    source_type: "institutional_site",
    description: "Primary corporate AI announcements; treat as source material, not independent reporting."
  },
  {
    id: "the-gradient",
    topic: "tech_ai",
    language: "en",
    publisher: "The Gradient",
    url: "https://thegradient.pub/",
    rssUrl: "https://thegradient.pub/rss/",
    credibility_score: 0.76,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Longer-form AI research and industry analysis."
  },
  {
    id: "mit-ai",
    topic: "tech_ai",
    language: "en",
    publisher: "MIT News",
    url: "https://news.mit.edu/topic/artificial-intelligence2",
    rssUrl: "https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml",
    credibility_score: 0.88,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "AI research and education updates with strong student and career relevance."
  },
  {
    id: "stanford-hai",
    topic: "tech_ai",
    language: "en",
    publisher: "Stanford HAI",
    region: "us",
    url: "https://hai.stanford.edu/news",
    rssUrl: "https://hai.stanford.edu/news/rss.xml",
    credibility_score: 0.86,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "AI research, policy, education, and human-centered AI institute updates."
  },
  {
    id: "arxiv-cs-ai",
    topic: "tech_ai",
    language: "en",
    publisher: "arXiv cs.AI",
    region: "global",
    url: "https://arxiv.org/list/cs.AI/recent",
    rssUrl: "https://export.arxiv.org/rss/cs.AI",
    credibility_score: 0.72,
    credibility_tier: "tier_3",
    source_type: "specialist_publisher",
    description: "Unreviewed AI research preprints; useful for trend discovery but requires editorial caution.",
    usage_notes: "Treat as early research signal, not confirmed findings."
  },
  {
    id: "scotusblog",
    topic: "law",
    language: "en",
    publisher: "SCOTUSblog",
    url: "https://www.scotusblog.com/",
    rssUrl: "https://www.scotusblog.com/feed/",
    credibility_score: 0.86,
    credibility_tier: "tier_1",
    source_type: "specialist_publisher",
    description: "U.S. Supreme Court reporting and legal analysis."
  },
  {
    id: "ftc-competition",
    topic: "law",
    language: "en",
    publisher: "Federal Trade Commission",
    url: "https://www.ftc.gov/news-events/news/press-releases",
    rssUrl: "https://www.ftc.gov/feeds/press-release-competition.xml",
    credibility_score: 0.94,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Primary-source competition, consumer protection, and platform regulation updates."
  },
  {
    id: "doj-news",
    topic: "law",
    language: "en",
    publisher: "U.S. Department of Justice",
    url: "https://www.justice.gov/news",
    rssUrl: "https://www.justice.gov/feeds/opa/justice-news.xml",
    credibility_score: 0.93,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Primary-source U.S. federal enforcement and legal policy updates."
  },
  {
    id: "eff-deeplinks",
    topic: "law",
    language: "en",
    publisher: "Electronic Frontier Foundation",
    url: "https://www.eff.org/deeplinks",
    rssUrl: "https://www.eff.org/deeplinks/index.xml",
    credibility_score: 0.82,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Digital rights, privacy, speech, surveillance, and technology law analysis."
  },
  {
    id: "us-courts-news",
    topic: "law",
    language: "en",
    publisher: "U.S. Courts",
    region: "us",
    url: "https://www.uscourts.gov/news",
    rssUrl: "https://www.uscourts.gov/news/rss.xml",
    credibility_score: 0.91,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "Primary-source federal judiciary updates, court administration, and civic legal context."
  },
  {
    id: "eu-commission-law",
    topic: "law",
    language: "en",
    publisher: "European Commission",
    region: "eu",
    url: "https://ec.europa.eu/commission/presscorner/",
    credibility_score: 0.88,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "Primary-source EU policy and legal/regulatory announcements.",
    usage_notes: "RSS endpoint varies by query; keep as a curated reference until a stable topic feed is confirmed."
  },
  {
    id: "nature-medicine",
    topic: "medicine",
    language: "en",
    publisher: "Nature Medicine",
    url: "https://www.nature.com/nm/",
    rssUrl: "https://www.nature.com/nm.rss",
    credibility_score: 0.95,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Peer-reviewed medical research table-of-contents feed."
  },
  {
    id: "nih-news-releases",
    topic: "medicine",
    language: "en",
    publisher: "National Institutes of Health",
    url: "https://www.nih.gov/news-events/news-releases",
    rssUrl: "https://www.nih.gov/news-releases/feed.xml",
    credibility_score: 0.94,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Primary-source biomedical research and public health news releases."
  },
  {
    id: "who-news",
    topic: "medicine",
    language: "en",
    publisher: "World Health Organization",
    url: "https://www.who.int/news",
    rssUrl: "https://www.who.int/rss-feeds/news-english.xml",
    credibility_score: 0.92,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Global public health news and institutional updates."
  },
  {
    id: "fda-press-releases",
    topic: "medicine",
    language: "en",
    publisher: "U.S. Food and Drug Administration",
    url: "https://www.fda.gov/news-events/fda-newsroom",
    rssUrl: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml",
    credibility_score: 0.94,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "Primary-source U.S. medical products, drug, device, and public health regulatory updates."
  },
  {
    id: "bmj-recent",
    topic: "medicine",
    language: "en",
    publisher: "The BMJ",
    region: "uk",
    url: "https://www.bmj.com/",
    rssUrl: "https://www.bmj.com/rss/recent.xml",
    credibility_score: 0.9,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Medical research, policy, and clinical practice updates from a major medical journal."
  },
  {
    id: "cdc-newsroom",
    topic: "medicine",
    language: "en",
    publisher: "Centers for Disease Control and Prevention",
    region: "us",
    url: "https://www.cdc.gov/media/",
    rssUrl: "https://tools.cdc.gov/api/v2/resources/media/132608.rss",
    credibility_score: 0.91,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "Primary-source U.S. public health advisories and newsroom updates."
  },
  {
    id: "ieee-spectrum",
    topic: "engineering",
    language: "en",
    publisher: "IEEE Spectrum",
    url: "https://spectrum.ieee.org/",
    rssUrl: "https://spectrum.ieee.org/feeds/feed.rss",
    credibility_score: 0.88,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Engineering, applied science, electronics, energy, and robotics coverage."
  },
  {
    id: "nasa-technology",
    topic: "engineering",
    language: "en",
    publisher: "NASA",
    url: "https://www.nasa.gov/technology/",
    rssUrl: "https://www.nasa.gov/technology/feed/",
    credibility_score: 0.91,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Primary-source aerospace, robotics, and advanced engineering updates."
  },
  {
    id: "nature-nanotechnology",
    topic: "engineering",
    language: "en",
    publisher: "Nature Nanotechnology",
    url: "https://www.nature.com/nnano/",
    rssUrl: "https://www.nature.com/nnano.rss",
    credibility_score: 0.93,
    credibility_tier: "tier_1",
    source_type: "rss",
    description: "Peer-reviewed nanotechnology research table-of-contents feed."
  },
  {
    id: "mit-engineering",
    topic: "engineering",
    language: "en",
    publisher: "MIT News",
    url: "https://news.mit.edu/school/engineering",
    rssUrl: "https://news.mit.edu/rss/school/engineering",
    credibility_score: 0.88,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "Engineering research, applied science, robotics, energy, and student innovation."
  },
  {
    id: "arxiv-robotics",
    topic: "engineering",
    language: "en",
    publisher: "arXiv cs.RO",
    region: "global",
    url: "https://arxiv.org/list/cs.RO/recent",
    rssUrl: "https://export.arxiv.org/rss/cs.RO",
    credibility_score: 0.72,
    credibility_tier: "tier_3",
    source_type: "specialist_publisher",
    description: "Unreviewed robotics preprints; useful for emerging engineering signals.",
    usage_notes: "Treat as early research signal and avoid unsupported factual claims."
  },
  {
    id: "nibib-news",
    topic: "engineering",
    language: "en",
    publisher: "National Institute of Biomedical Imaging and Bioengineering",
    region: "us",
    url: "https://www.nibib.nih.gov/news-events/newsroom",
    credibility_score: 0.9,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "Biomedical engineering, imaging, devices, and translational health technology updates.",
    usage_notes: "Keep as a curated reference until a stable public feed is confirmed."
  },
  {
    id: "sportspro",
    topic: "sport_business",
    language: "en",
    publisher: "SportsPro",
    url: "https://www.sportspromedia.com/",
    rssUrl: "https://www.sportspromedia.com/feed/",
    credibility_score: 0.78,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Sports media rights, sponsorship, leagues, and investment coverage."
  },
  {
    id: "sportbusiness",
    topic: "sport_business",
    language: "en",
    publisher: "SportBusiness",
    url: "https://www.sportbusiness.com/",
    rssUrl: "https://www.sportbusiness.com/feed/",
    credibility_score: 0.78,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Sports industry, rights, governance, and commercial strategy coverage."
  },
  {
    id: "front-office-sports",
    topic: "sport_business",
    language: "en",
    publisher: "Front Office Sports",
    url: "https://frontofficesports.com/",
    rssUrl: "https://frontofficesports.com/feed/",
    credibility_score: 0.74,
    credibility_tier: "tier_3",
    source_type: "specialist_publisher",
    description: "Sports business news with a strong audience and career lens."
  },
  {
    id: "sportico",
    topic: "sport_business",
    language: "en",
    publisher: "Sportico",
    url: "https://www.sportico.com/",
    rssUrl: "https://www.sportico.com/feed/",
    credibility_score: 0.77,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Sports finance, team valuations, media rights, sponsorships, and leagues."
  },
  {
    id: "sports-travel-magazine",
    topic: "sport_business",
    language: "en",
    publisher: "SportsTravel Magazine",
    region: "us",
    url: "https://www.sportstravelmagazine.com/",
    rssUrl: "https://www.sportstravelmagazine.com/feed/",
    credibility_score: 0.7,
    credibility_tier: "tier_3",
    source_type: "specialist_publisher",
    description: "Sports events, destinations, venue economics, and tournament operations."
  },
  {
    id: "sports-business-journal",
    topic: "sport_business",
    language: "en",
    publisher: "Sports Business Journal",
    region: "us",
    url: "https://www.sportsbusinessjournal.com/",
    credibility_score: 0.82,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Sports business trade reporting; maintain as a reference while feed licensing is reviewed.",
    usage_notes: "No RSS URL enabled until licensing and a stable feed endpoint are confirmed."
  },
  {
    id: "guardian-media",
    topic: "culture_media",
    language: "en",
    publisher: "The Guardian",
    url: "https://www.theguardian.com/media",
    rssUrl: "https://www.theguardian.com/media/rss",
    credibility_score: 0.84,
    credibility_tier: "tier_2",
    source_type: "rss",
    description: "Media industry, journalism, streaming, and culture business coverage."
  },
  {
    id: "nieman-lab",
    topic: "culture_media",
    language: "en",
    publisher: "Nieman Journalism Lab",
    url: "https://www.niemanlab.org/",
    rssUrl: "https://www.niemanlab.org/feed/",
    credibility_score: 0.84,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Journalism, media technology, publishing models, and platform shifts."
  },
  {
    id: "variety",
    topic: "culture_media",
    language: "en",
    publisher: "Variety",
    url: "https://variety.com/",
    rssUrl: "https://variety.com/feed/",
    credibility_score: 0.78,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Entertainment business, film, TV, streaming, and cultural industries."
  },
  {
    id: "deadline",
    topic: "culture_media",
    language: "en",
    publisher: "Deadline",
    url: "https://deadline.com/",
    rssUrl: "https://deadline.com/feed/",
    credibility_score: 0.76,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Entertainment industry, streaming, studios, labor, and media business coverage."
  },
  {
    id: "columbia-journalism-review",
    topic: "culture_media",
    language: "en",
    publisher: "Columbia Journalism Review",
    region: "us",
    url: "https://www.cjr.org/",
    rssUrl: "https://www.cjr.org/feed",
    credibility_score: 0.82,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Journalism, media institutions, trust, platforms, and publishing economics."
  },
  {
    id: "hollywood-reporter",
    topic: "culture_media",
    language: "en",
    publisher: "The Hollywood Reporter",
    region: "us",
    url: "https://www.hollywoodreporter.com/",
    rssUrl: "https://www.hollywoodreporter.com/feed/",
    credibility_score: 0.76,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "Entertainment industry, studios, awards, streaming, labor, and cultural business coverage."
  },
  {
    id: "le-monde-economie",
    topic: "business",
    language: "fr",
    publisher: "Le Monde",
    url: "https://www.lemonde.fr/economie/",
    credibility_score: 0.86,
    credibility_tier: "tier_1",
    source_type: "publisher_section",
    description: "French economy and business reporting.",
    usage_notes: "RSS reuse requires permission for non-personal or collective use; keep disabled until licensed."
  },
  {
    id: "le-monde-argent",
    topic: "finance",
    language: "fr",
    publisher: "Le Monde",
    url: "https://www.lemonde.fr/argent/",
    credibility_score: 0.84,
    credibility_tier: "tier_1",
    source_type: "publisher_section",
    description: "French personal finance and markets context.",
    usage_notes: "RSS reuse requires permission for non-personal or collective use; keep disabled until licensed."
  },
  {
    id: "le-monde-pixels",
    topic: "tech_ai",
    language: "fr",
    publisher: "Le Monde Pixels",
    url: "https://www.lemonde.fr/pixels/",
    credibility_score: 0.84,
    credibility_tier: "tier_1",
    source_type: "publisher_section",
    description: "French technology, platforms, and digital policy coverage.",
    usage_notes: "RSS reuse requires permission for non-personal or collective use; keep disabled until licensed."
  },
  {
    id: "conseil-constitutionnel",
    topic: "law",
    language: "fr",
    publisher: "Conseil constitutionnel",
    url: "https://www.conseil-constitutionnel.fr/",
    credibility_score: 0.93,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "Primary-source French constitutional law decisions and institutional updates."
  },
  {
    id: "inserm",
    topic: "medicine",
    language: "fr",
    publisher: "Inserm",
    url: "https://www.inserm.fr/actualite/",
    credibility_score: 0.92,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "Primary-source French biomedical research news."
  },
  {
    id: "cnrs-ingenierie",
    topic: "engineering",
    language: "fr",
    publisher: "CNRS",
    url: "https://www.cnrs.fr/fr/actualites",
    credibility_score: 0.9,
    credibility_tier: "tier_1",
    source_type: "institutional_site",
    description: "French scientific research updates; filter for engineering and applied science."
  },
  {
    id: "sportstrategies",
    topic: "sport_business",
    language: "fr",
    publisher: "Sport Strategies",
    url: "https://www.sportstrategies.com/",
    credibility_score: 0.72,
    credibility_tier: "tier_3",
    source_type: "specialist_publisher",
    description: "French sports marketing, sponsorship, and sports business coverage."
  },
  {
    id: "ina-medias",
    topic: "culture_media",
    language: "fr",
    publisher: "INA",
    url: "https://larevuedesmedias.ina.fr/",
    credibility_score: 0.82,
    credibility_tier: "tier_2",
    source_type: "specialist_publisher",
    description: "French media analysis and cultural industry context."
  }
];

export const CURATED_SOURCES = CURATED_SOURCE_DEFINITIONS.map((source) => ({
  ...source,
  region: source.region ?? inferSourceRegion(source)
})) satisfies CuratedSource[];

function inferSourceRegion(source: CuratedSourceDefinition): SourceRegion {
  if (source.language === "fr" || source.url.includes(".fr/")) {
    return "fr";
  }

  if (
    source.publisher.includes("U.S.") ||
    source.publisher.includes("Federal") ||
    source.publisher.includes("SEC") ||
    source.publisher.includes("NASA") ||
    source.publisher.includes("NIH") ||
    source.publisher.includes("FDA") ||
    source.publisher.includes("Department of Justice")
  ) {
    return "us";
  }

  if (source.publisher.includes("BBC") || source.publisher.includes("Guardian") || source.publisher.includes("Nature")) {
    return "uk";
  }

  if (source.publisher.includes("European Central Bank")) {
    return "eu";
  }

  if (source.publisher.includes("NPR") || source.publisher.includes("Marketplace")) {
    return "us";
  }

  return "global";
}

export const CURATED_SOURCES_BY_TOPIC = CURATED_SOURCES.reduce(
  (sourcesByTopic, source) => {
    sourcesByTopic[source.topic].push(source);
    return sourcesByTopic;
  },
  {
    business: [],
    finance: [],
    tech_ai: [],
    law: [],
    medicine: [],
    engineering: [],
    sport_business: [],
    culture_media: []
  } as Record<CuratedSource["topic"], CuratedSource[]>
);

export const CURATED_SOURCE_COVERAGE = Object.fromEntries(
  Object.entries(CURATED_SOURCES_BY_TOPIC).map(([topic, sources]) => [
    topic,
    {
      source_count: sources.length,
      live_rss_count: sources.filter((source) => source.rssUrl).length,
      tier_1_count: sources.filter((source) => source.credibility_tier === "tier_1").length,
      regions: Array.from(new Set(sources.map((source) => source.region))).sort()
    }
  ])
) as Record<
  TopicId,
  {
    live_rss_count: number;
    regions: SourceRegion[];
    source_count: number;
    tier_1_count: number;
  }
>;
