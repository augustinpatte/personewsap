import type { Language } from "../domain.js";
import { ContentRepository } from "../storage/contentRepository.js";
import { createServiceRoleSupabaseClient } from "../storage/supabaseClient.js";
import { toDateOnly } from "../utils/date.js";

export type BusinessStoryMemoryOptions = {
  dropDate: string;
  language?: Language;
  limit: number;
};

export type BusinessStoryMemoryOutput = {
  mode: "business-story-memory";
  checked_at: string;
  drop_date: string;
  language: Language | "all";
  last_10_business_stories: Array<{
    title: string;
    entity_name: string;
    entity_type: string;
    main_company: string;
    industry: string;
    key_mechanism: string;
    strategic_angle: string;
    published_date: string;
    slug: string;
  }>;
  mechanisms_last_30_days: string[];
  industries_last_30_days: string[];
  entities_blocked_by_cooldown: string[];
  companies_blocked_by_cooldown: string[];
  strategic_angles_last_30_days: string[];
  next_recommended_underused: {
    mechanisms: string[];
    industries: string[];
    entity_types: string[];
    geographies: string[];
    time_periods: string[];
  };
};

export async function runBusinessStoryMemory(options: BusinessStoryMemoryOptions): Promise<BusinessStoryMemoryOutput> {
  const repository = new ContentRepository(
    createServiceRoleSupabaseClient({
      requireCredentials: true
    })
  );
  const context = await repository.listBusinessStoryHistoryReport({
    language: options.language,
    dropDate: options.dropDate,
    limit: Math.max(options.limit, 180)
  });

  return {
    mode: "business-story-memory",
    checked_at: new Date().toISOString(),
    drop_date: options.dropDate,
    language: options.language ?? "all",
    last_10_business_stories: context.recentStories.slice(0, 10).map((entry) => ({
      title: entry.title,
      entity_name: entry.entity_name,
      entity_type: entry.entity_type,
      main_company: entry.main_company,
      industry: entry.industry,
      key_mechanism: entry.key_mechanism,
      strategic_angle: entry.strategic_angle,
      published_date: entry.published_date,
      slug: entry.slug
    })),
    mechanisms_last_30_days: context.recentMechanisms,
    industries_last_30_days: context.recentIndustries,
    entities_blocked_by_cooldown: context.bannedEntities,
    companies_blocked_by_cooldown: context.bannedCompanies,
    strategic_angles_last_30_days: context.recentStrategicAngles,
    next_recommended_underused: {
      mechanisms: context.underusedMechanisms,
      industries: context.underusedIndustries,
      entity_types: context.underusedEntityTypes,
      geographies: context.underusedGeographies,
      time_periods: context.underusedTimePeriods
    }
  };
}

export function parseBusinessStoryMemoryOptions(args: string[]): BusinessStoryMemoryOptions {
  const flags = readFlags(args);
  const rawLanguage = flags.get("language");

  if (rawLanguage && rawLanguage !== "fr" && rawLanguage !== "en") {
    throw new Error("--language must be fr or en.");
  }
  const language = rawLanguage as Language | undefined;

  const limit = Number(flags.get("limit") ?? "180");
  if (!Number.isInteger(limit) || limit < 10 || limit > 500) {
    throw new Error("--limit must be an integer from 10 to 500.");
  }

  return {
    dropDate: flags.get("date") ?? toDateOnly(new Date()),
    language,
    limit
  };
}

function readFlags(args: string[]): Map<string, string> {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const next = args[index + 1];
    const value = inlineValue ?? (next && !next.startsWith("--") ? next : "true");
    if (inlineValue === undefined && next && !next.startsWith("--")) {
      index += 1;
    }
    values.set(rawKey, value);
  }

  return values;
}
