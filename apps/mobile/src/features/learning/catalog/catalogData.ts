import { getCachedValue, setCachedValue } from "../../../lib/memoryCache";
import { normalizeSupabaseError, supabase } from "../../../lib/supabase";
import type { LearningCatalogStep } from "./catalogTypes";

/**
 * Curriculum steps for one domain, read from public.learning_catalog_domains.
 *
 * The catalog is shared reference data (not user data), so it is fetched once
 * per domain and cached for the session: advancing a path several times in a
 * row costs a single request. Only the reader's own domain is fetched, never
 * the whole curriculum.
 */

const CATALOG_CACHE_TTL_MS = 30 * 60_000;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** Defensive parse: a malformed row must not crash the path, just yield no step. */
export function parseCatalogSteps(payload: unknown): LearningCatalogStep[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }

  const steps = (payload as { steps?: unknown }).steps;

  if (!Array.isArray(steps)) {
    return [];
  }

  return steps.filter((step): step is LearningCatalogStep => {
    if (typeof step !== "object" || step === null) {
      return false;
    }

    const candidate = step as Record<string, unknown>;

    return (
      typeof candidate.key === "string" &&
      typeof candidate.domain_id === "string" &&
      isStringArray(candidate.objective_ids) &&
      typeof candidate.stage === "number" &&
      typeof candidate.order === "number" &&
      typeof candidate.title_fr === "string" &&
      typeof candidate.title_en === "string" &&
      isStringArray(candidate.prerequisite_keys)
    );
  });
}

export async function fetchLearningCatalogSteps(
  domainId: string
): Promise<LearningCatalogStep[]> {
  if (!supabase || !domainId) {
    return [];
  }

  const cacheKey = `learning-catalog:${domainId}`;
  const cached = getCachedValue<LearningCatalogStep[]>(cacheKey);

  if (cached) {
    return cached;
  }

  const { data, error } = await supabase
    .from("learning_catalog_domains")
    .select("domain_id,version,payload")
    .eq("domain_id", domainId)
    .maybeSingle();

  if (error || !data) {
    if (__DEV__ && error) {
      console.warn("[LearningPath] could not read the curriculum", normalizeSupabaseError(error));
    }
    return [];
  }

  const steps = parseCatalogSteps(data.payload);
  setCachedValue(cacheKey, steps, CATALOG_CACHE_TTL_MS);

  return steps;
}
