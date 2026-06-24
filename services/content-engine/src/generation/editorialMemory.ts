import {
  BUSINESS_STORY_ENTITY_TYPES,
  EDITORIAL_MEMORY_LIMIT,
  type BusinessStory,
  type BusinessStoryEditorialMemoryEntry,
  type BusinessStoryEditorialMemoryFields,
  type BusinessStoryEntityType,
  type BusinessStoryMemoryContext,
  type Language
} from "../domain.js";

const DEFAULT_UNDERUSED_INDUSTRIES = [
  "software",
  "consumer",
  "finance",
  "health/pharma",
  "industrial",
  "media",
  "energy",
  "logistics",
  "education",
  "automotive"
] as const;

const DEFAULT_UNDERUSED_MECHANISMS = [
  "pricing power",
  "distribution leverage",
  "regulatory constraint",
  "operational bottleneck",
  "trust repair",
  "capacity allocation",
  "market entry",
  "incentive design",
  "bundling",
  "switching costs"
] as const;

const DEFAULT_UNDERUSED_GEOGRAPHIES = ["Europe", "North America", "Asia", "Africa", "Latin America"] as const;
const DEFAULT_UNDERUSED_TIME_PERIODS = ["2020s", "2010s", "2000s", "1990s", "pre-1990"] as const;

export function buildBusinessStoryEditorialMemory(input: {
  item: BusinessStory;
  contentItemId: string | null;
  publishedDate: string;
}): BusinessStoryEditorialMemoryEntry {
  const explicit = normalizeEditorialMemoryFields(input.item.editorial_memory);
  const fallback = inferEditorialMemoryFields(input.item);
  const fields = {
    ...fallback,
    ...explicit
  };

  return {
    ...fields,
    content_item_id: input.contentItemId,
    title: input.item.title,
    slug: slugify(input.item.title),
    language: input.item.language,
    published_date: input.publishedDate
  };
}

export function buildBusinessStoryMemoryContext(input: {
  entries: BusinessStoryEditorialMemoryEntry[];
  dropDate: string;
  language?: Language;
}): BusinessStoryMemoryContext {
  const entries = input.entries
    .filter((entry) => !input.language || entry.language === input.language)
    .sort((left, right) => right.published_date.localeCompare(left.published_date));
  // Editorial memory is capped at the 50 most recent stories (EDITORIAL_MEMORY_LIMIT).
  const recentStories = entries.slice(0, EDITORIAL_MEMORY_LIMIT);
  const last180 = filterSince(entries, input.dropDate, 180);
  const last90 = filterSince(entries, input.dropDate, 90);
  const last30 = filterSince(entries, input.dropDate, 30);
  const last14 = filterSince(entries, input.dropDate, 14);

  return {
    recentStories,
    bannedEntities: uniqueNormalized(last180.map((entry) => entry.entity_name)),
    bannedCompanies: uniqueNormalized(last90.map((entry) => entry.main_company)),
    recentMechanisms: uniqueNormalized(last30.map((entry) => entry.key_mechanism)),
    recentIndustries: uniqueNormalized(last30.map((entry) => entry.industry)),
    recentStrategicAngles: uniqueNormalized(last30.map((entry) => entry.strategic_angle)),
    underusedIndustries: leastUsed(DEFAULT_UNDERUSED_INDUSTRIES, recentStories.map((entry) => entry.industry), 5),
    underusedMechanisms: leastUsed(DEFAULT_UNDERUSED_MECHANISMS, recentStories.map((entry) => entry.key_mechanism), 5),
    underusedEntityTypes: leastUsed(BUSINESS_STORY_ENTITY_TYPES, recentStories.map((entry) => entry.entity_type), 4),
    underusedGeographies: leastUsed(DEFAULT_UNDERUSED_GEOGRAPHIES, recentStories.flatMap((entry) => splitGeographies(entry)), 3),
    underusedTimePeriods: leastUsed(DEFAULT_UNDERUSED_TIME_PERIODS, recentStories.map((entry) => entry.year_period), 3)
  };
}

export function compactBusinessStoryMemoryForPrompt(context?: BusinessStoryMemoryContext | null) {
  if (!context) {
    return {
      available: false,
      instruction: "No persisted business-story memory was supplied for this run."
    };
  }

  return {
    available: true,
    hard_avoid: {
      banned_entities_180_days: context.bannedEntities.slice(0, 40),
      banned_companies_90_days: context.bannedCompanies.slice(0, 40),
      recently_used_mechanisms_30_days: context.recentMechanisms.slice(0, 30),
      recently_used_industries_30_days: context.recentIndustries.slice(0, 30),
      recently_used_angles_30_days: context.recentStrategicAngles.slice(0, 30)
    },
    preferred_underused: {
      industries: context.underusedIndustries,
      mechanisms: context.underusedMechanisms,
      entity_types: context.underusedEntityTypes,
      geographies: context.underusedGeographies,
      time_periods: context.underusedTimePeriods
    },
    // Compact memory only (never full past content), capped at EDITORIAL_MEMORY_LIMIT items.
    recent_story_sample: context.recentStories.slice(0, EDITORIAL_MEMORY_LIMIT).map((entry) => ({
      title: entry.title,
      entity_name: entry.entity_name,
      main_company: entry.main_company,
      industry: entry.industry,
      key_mechanism: entry.key_mechanism,
      strategic_angle: entry.strategic_angle,
      core_takeaway: entry.core_takeaway,
      one_line_summary: entry.core_takeaway,
      published_date: entry.published_date
    }))
  };
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);

  return slug || "business-story";
}

export function normalizeMemoryKey(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function daysBetween(dateLeft: string, dateRight: string): number {
  const left = Date.parse(dateLeft);
  const right = Date.parse(dateRight);

  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.floor((right - left) / 86_400_000);
}

function normalizeEditorialMemoryFields(
  value: BusinessStoryEditorialMemoryFields | undefined
): Partial<BusinessStoryEditorialMemoryFields> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: Partial<BusinessStoryEditorialMemoryFields> = {};
  setDefined(normalized, "entity_name", cleanText(value.entity_name));
  setDefined(normalized, "entity_type", isBusinessStoryEntityType(value.entity_type) ? value.entity_type : undefined);
  setDefined(normalized, "main_company", cleanText(value.main_company));
  setDefined(normalized, "companies_mentioned", cleanTextArray(value.companies_mentioned));
  setDefined(normalized, "industry", cleanText(value.industry));
  setDefined(normalized, "key_mechanism", cleanText(value.key_mechanism));
  setDefined(normalized, "secondary_mechanisms", cleanTextArray(value.secondary_mechanisms));
  setDefined(normalized, "strategic_angle", cleanText(value.strategic_angle));
  setDefined(normalized, "core_takeaway", cleanText(value.core_takeaway));
  setDefined(normalized, "year_period", cleanText(value.year_period));
  return normalized;
}

function inferEditorialMemoryFields(item: BusinessStory): BusinessStoryEditorialMemoryFields {
  const mechanism = inferMechanism(`${item.tension} ${item.decision} ${item.lesson}`);
  const industry = inferIndustry(item.topic, `${item.company_or_market} ${item.title} ${item.body_md}`);

  return {
    entity_name: item.company_or_market,
    entity_type: inferEntityType(item.title, item.company_or_market),
    main_company: item.company_or_market,
    companies_mentioned: [item.company_or_market],
    industry,
    key_mechanism: mechanism,
    secondary_mechanisms: inferSecondaryMechanisms(`${item.setup} ${item.tension} ${item.decision} ${item.lesson}`, mechanism),
    strategic_angle: cleanText(item.decision) ?? mechanism,
    core_takeaway: cleanText(item.lesson) ?? item.title,
    year_period: inferYearPeriod(item.story_date)
  };
}

function inferEntityType(title: string, companyOrMarket: string): BusinessStoryEntityType {
  const text = normalizeMemoryKey(`${title} ${companyOrMarket}`);

  if (text.includes("founder")) return "founder";
  if (text.includes("ceo")) return "ceo";
  if (text.includes("investor") || text.includes("fund")) return "investor";
  if (text.includes("product") || text.includes("platform")) return "product";
  if (text.includes("crisis") || text.includes("scandal")) return "crisis";
  if (text.includes("acquisition") || text.includes("merger") || text.includes("deal")) return "acquisition";
  if (text.includes("strategy") || text.includes("reset")) return "strategy";
  return "company";
}

function inferMechanism(text: string): string {
  const normalized = normalizeMemoryKey(text);
  const mechanisms = [...DEFAULT_UNDERUSED_MECHANISMS];

  return mechanisms.find((mechanism) => normalized.includes(normalizeMemoryKey(mechanism))) ?? "operational bottleneck";
}

function inferSecondaryMechanisms(text: string, primary: string): string[] {
  const normalized = normalizeMemoryKey(text);

  return DEFAULT_UNDERUSED_MECHANISMS
    .filter((mechanism) => mechanism !== primary && normalized.includes(normalizeMemoryKey(mechanism)))
    .slice(0, 4);
}

function inferIndustry(topic: BusinessStory["topic"], text: string): string {
  const normalized = normalizeMemoryKey(text);

  if (normalized.includes("bank") || normalized.includes("rate") || normalized.includes("credit")) return "finance";
  if (normalized.includes("health") || normalized.includes("pharma") || normalized.includes("clinical")) return "health/pharma";
  if (normalized.includes("auto") || normalized.includes("vehicle") || normalized.includes("battery")) return "automotive";
  if (normalized.includes("energy") || normalized.includes("power")) return "energy";
  if (normalized.includes("media") || normalized.includes("creator") || normalized.includes("content")) return "media";
  if (topic === "tech_ai") return "software";
  if (topic === "finance") return "finance";
  if (topic === "medicine") return "health/pharma";
  if (topic === "engineering") return "industrial";
  if (topic === "culture_media") return "media";
  return "consumer";
}

function inferYearPeriod(storyDate: string): string {
  const year = Number(storyDate.slice(0, 4));

  if (!Number.isFinite(year)) return "unknown";
  if (year >= 2020) return "2020s";
  if (year >= 2010) return "2010s";
  if (year >= 2000) return "2000s";
  if (year >= 1990) return "1990s";
  return "pre-1990";
}

function filterSince(entries: BusinessStoryEditorialMemoryEntry[], dropDate: string, days: number) {
  return entries.filter((entry) => {
    const delta = daysBetween(entry.published_date, dropDate);
    return delta >= 0 && delta <= days;
  });
}

function leastUsed<const T extends readonly string[]>(candidates: T, usedValues: string[], limit: number): Array<T[number]> {
  const counts = new Map<string, number>();
  for (const value of usedValues) {
    const key = normalizeMemoryKey(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...candidates]
    .sort((left, right) => (counts.get(normalizeMemoryKey(left)) ?? 0) - (counts.get(normalizeMemoryKey(right)) ?? 0) || left.localeCompare(right))
    .slice(0, limit) as Array<T[number]>;
}

function uniqueNormalized(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const normalized = normalizeMemoryKey(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(value.trim());
  }

  return unique;
}

function cleanText(value: string | null | undefined): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function cleanTextArray(values: string[] | null | undefined): string[] | undefined {
  const cleaned = (values ?? []).map(cleanText).filter((value): value is string => Boolean(value));
  return cleaned.length > 0 ? Array.from(new Set(cleaned)) : undefined;
}

function isBusinessStoryEntityType(value: string): value is BusinessStoryEntityType {
  return BUSINESS_STORY_ENTITY_TYPES.includes(value as BusinessStoryEntityType);
}

function setDefined<Key extends keyof BusinessStoryEditorialMemoryFields>(
  target: Partial<BusinessStoryEditorialMemoryFields>,
  key: Key,
  value: BusinessStoryEditorialMemoryFields[Key] | undefined
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function splitGeographies(entry: BusinessStoryEditorialMemoryEntry): string[] {
  const text = normalizeMemoryKey(`${entry.title} ${entry.core_takeaway} ${entry.main_company}`);
  const geographies: string[] = [];

  if (/\beu\b|\beurope\b|\bfrance\b|\bgermany\b|\buk\b/.test(text)) geographies.push("Europe");
  if (/\bus\b|\bu s\b|\bamerica\b|\bcanada\b/.test(text)) geographies.push("North America");
  if (/\bchina\b|\bindia\b|\bjapan\b|\basia\b/.test(text)) geographies.push("Asia");
  if (/\bafrica\b|\bnigeria\b|\bkenya\b|\bsouth africa\b/.test(text)) geographies.push("Africa");
  if (/\bbrazil\b|\bmexico\b|\blatin america\b/.test(text)) geographies.push("Latin America");

  return geographies.length > 0 ? geographies : ["North America"];
}
