import type { CuratedSource } from "./types.js";

export const CURATED_SOURCES: CuratedSource[] = [
  {
    id: "bbc-business",
    topic: "business",
    language: "en",
    publisher: "BBC",
    url: "https://www.bbc.com/business",
    rssUrl: "https://feeds.bbci.co.uk/news/business/rss.xml",
    credibility_score: 0.88
  },
  {
    id: "reuters-business",
    topic: "business",
    language: "en",
    publisher: "Reuters",
    url: "https://www.reuters.com/business/",
    credibility_score: 0.94
  },
  {
    id: "reuters-markets",
    topic: "finance",
    language: "en",
    publisher: "Reuters",
    url: "https://www.reuters.com/markets/",
    credibility_score: 0.94
  },
  {
    id: "mit-tech-review",
    topic: "tech_ai",
    language: "en",
    publisher: "MIT Technology Review",
    url: "https://www.technologyreview.com/",
    rssUrl: "https://www.technologyreview.com/feed/",
    credibility_score: 0.9
  },
  {
    id: "nature-medicine",
    topic: "medicine",
    language: "en",
    publisher: "Nature Medicine",
    url: "https://www.nature.com/nm/",
    rssUrl: "https://www.nature.com/nm.rss",
    credibility_score: 0.95
  },
  {
    id: "ieee-spectrum",
    topic: "engineering",
    language: "en",
    publisher: "IEEE Spectrum",
    url: "https://spectrum.ieee.org/",
    rssUrl: "https://spectrum.ieee.org/feeds/feed.rss",
    credibility_score: 0.88
  },
  {
    id: "conseil-constitutionnel",
    topic: "law",
    language: "fr",
    publisher: "Conseil constitutionnel",
    url: "https://www.conseil-constitutionnel.fr/",
    credibility_score: 0.93
  },
  {
    id: "le-monde-economie",
    topic: "business",
    language: "fr",
    publisher: "Le Monde",
    url: "https://www.lemonde.fr/economie/",
    rssUrl: "https://www.lemonde.fr/economie/rss_full.xml",
    credibility_score: 0.86
  },
  {
    id: "inserm",
    topic: "medicine",
    language: "fr",
    publisher: "Inserm",
    url: "https://www.inserm.fr/actualite/",
    credibility_score: 0.92
  },
  {
    id: "the-guardian-media",
    topic: "culture_media",
    language: "en",
    publisher: "The Guardian",
    url: "https://www.theguardian.com/media",
    rssUrl: "https://www.theguardian.com/media/rss",
    credibility_score: 0.84
  },
  {
    id: "sportspro",
    topic: "sport_business",
    language: "en",
    publisher: "SportsPro",
    url: "https://www.sportspromedia.com/",
    rssUrl: "https://www.sportspromedia.com/feed/",
    credibility_score: 0.78
  }
];
