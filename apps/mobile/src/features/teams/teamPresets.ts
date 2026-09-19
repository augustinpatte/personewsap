import type { IconBadgeName } from "../../components";
import {
  MINI_CASE_TOPIC_IDS,
  MINI_CASE_TO_BACKEND_TOPIC_ID,
  type MiniCaseTopicId
} from "../onboarding/options";
import type { TopicId } from "../../types/domain";
import { MAX_ARTICLES_PER_TOPIC, type TeamConfigDraft } from "./teamConfigOptions";

/**
 * Team presets: a good first configuration in two taps.
 *
 * A PRESET IS A STARTING POINT, NOT A KIND OF TEAM. Applying one produces an
 * ordinary TeamConfigDraft — newsletter topics with 1 or 2 articles, mini-case
 * topics — which is saved through the same update_team_config as a hand-built
 * one. Nothing records which preset a Team came from, so a Team made from
 * "Finance" is simply a Team with those topics, and changing or removing a
 * preset here can never change a Team that already exists.
 *
 * THE NUMBERS ARE THE EDITION'S, NOT A GUESS. A scheduled edition is refused
 * unless it carries exactly 16 newsletter articles — two for each of the eight
 * topics — and six mini cases, one for each mini-case topic
 * (services/content-engine/src/staging/stagingBatch.ts). The Team assignment
 * takes up to `articles_count` of a topic's articles and one mini case per
 * configured mini-case topic, with no fallback to another topic
 * (materialize_team_content_assignments). So every configuration below asks for
 * at most two articles per topic and distinct mini-case topics: all of it exists
 * in a normal edition, and none of it depends on a fallback that is not there.
 */

export type TeamPresetId =
  | "finance"
  | "business"
  | "tech_ai"
  | "law"
  | "medicine"
  | "engineering"
  | "sport_business"
  | "culture_media"
  | "balanced";

export type TeamIntensityId = "chill" | "regular" | "intensive";

export type TeamPreset = {
  id: TeamPresetId;
  icon: IconBadgeName;
  /**
   * Newsletter topics in order of preference. A focused preset leads with its
   * own topic; Balanced is ordered for breadth (see BALANCED_ORDER).
   */
  orderedTopicIds: TopicId[];
};

export type TeamIntensity = {
  id: TeamIntensityId;
  /**
   * Articles per topic for a focused preset, in the preset's priority order.
   * Its length is the number of topics selected.
   */
  focusedArticles: readonly number[];
  /** Mini cases per edition, each from a different mini-case topic. */
  miniCases: number;
};

/**
 * Balanced goes round the domains before it goes deep in any of them: the
 * economy, technology and industry, institutions and health, culture and
 * sport. The first four entries are one from each family, so even the smallest
 * Balanced selection spans two families and the default one spans three.
 */
export const TOPIC_FAMILIES: Record<TopicId, "economy" | "technology" | "society" | "culture"> = {
  business: "economy",
  finance: "economy",
  tech_ai: "technology",
  engineering: "technology",
  law: "society",
  medicine: "society",
  culture_media: "culture",
  sport_business: "culture"
};

const BALANCED_ORDER: TopicId[] = [
  "business",
  "tech_ai",
  "law",
  "culture_media",
  "medicine",
  "engineering",
  "finance",
  "sport_business"
];

export const TEAM_PRESETS: readonly TeamPreset[] = [
  { id: "finance", icon: "trending-up", orderedTopicIds: ["finance", "business", "tech_ai", "law"] },
  { id: "business", icon: "briefcase", orderedTopicIds: ["business", "finance", "tech_ai", "law"] },
  { id: "tech_ai", icon: "cpu", orderedTopicIds: ["tech_ai", "engineering", "business", "finance"] },
  { id: "law", icon: "shield", orderedTopicIds: ["law", "business", "finance", "tech_ai"] },
  { id: "medicine", icon: "activity", orderedTopicIds: ["medicine", "tech_ai", "business", "law"] },
  { id: "engineering", icon: "tool", orderedTopicIds: ["engineering", "tech_ai", "business", "finance"] },
  {
    id: "sport_business",
    icon: "award",
    orderedTopicIds: ["sport_business", "business", "finance", "culture_media"]
  },
  {
    id: "culture_media",
    icon: "film",
    orderedTopicIds: ["culture_media", "business", "tech_ai", "finance"]
  },
  { id: "balanced", icon: "compass", orderedTopicIds: BALANCED_ORDER }
];

/**
 * Three levels, the middle one the default.
 *
 * Regular is 3 articles and 1 mini case: the shape a solo reader already gets
 * (a few articles and one case), so choosing a preset does not make a Team
 * heavier than the product already is. Chill drops a topic. Intensive doubles
 * the volume — two articles for the two leading topics, a fourth topic, a
 * second mini case — which is 18 questions an edition against Regular's 9, and
 * still under half of what one edition publishes.
 */
export const TEAM_INTENSITY_LEVELS: readonly TeamIntensity[] = [
  { id: "chill", focusedArticles: [1, 1], miniCases: 1 },
  { id: "regular", focusedArticles: [1, 1, 1], miniCases: 1 },
  { id: "intensive", focusedArticles: [2, 2, 1, 1], miniCases: 2 }
];

export const DEFAULT_TEAM_INTENSITY: TeamIntensityId = "regular";

export function getTeamPreset(id: TeamPresetId): TeamPreset {
  const preset = TEAM_PRESETS.find((entry) => entry.id === id);

  if (!preset) {
    throw new Error(`Unknown team preset: ${id}`);
  }

  return preset;
}

export function getTeamIntensity(id: TeamIntensityId): TeamIntensity {
  const intensity = TEAM_INTENSITY_LEVELS.find((entry) => entry.id === id);

  if (!intensity) {
    throw new Error(`Unknown team intensity: ${id}`);
  }

  return intensity;
}

export function isTeamPresetId(value: string): value is TeamPresetId {
  return TEAM_PRESETS.some((preset) => preset.id === value);
}

export function isTeamIntensityId(value: string): value is TeamIntensityId {
  return TEAM_INTENSITY_LEVELS.some((level) => level.id === value);
}

/**
 * The mini cases a preset leans towards, derived rather than listed: walk the
 * preset's topics in order and take the mini-case topics that belong to each.
 * Business, Sports Business and Culture & Media have no mini-case topic of their
 * own, so a preset led by one of them takes its cases from the next topic in
 * its list that has some — a Sports Business Team plays the Finance cases.
 */
function miniCasePreferenceOrder(preset: TeamPreset): MiniCaseTopicId[] {
  const order: MiniCaseTopicId[] = [];

  for (const topicId of preset.orderedTopicIds) {
    for (const miniCaseId of MINI_CASE_TOPIC_IDS) {
      if (MINI_CASE_TO_BACKEND_TOPIC_ID[miniCaseId] === topicId && !order.includes(miniCaseId)) {
        order.push(miniCaseId);
      }
    }
  }

  return order;
}

/**
 * Preset × intensity → the configuration to create the Team with.
 *
 * Pure and deterministic: the same two ids always give the same draft, with
 * topics in the preset's order (which becomes the server's `position`).
 *
 * A focused preset takes as many of its topics as the level has entries, with
 * the level's article counts. Balanced spends the SAME article budget one
 * article per topic, across more domains — the same volume as any other
 * preset at that level, spread wide instead of deep.
 */
export function applyTeamPreset(presetId: TeamPresetId, intensityId: TeamIntensityId): TeamConfigDraft {
  const preset = getTeamPreset(presetId);
  const intensity = getTeamIntensity(intensityId);

  const articles =
    preset.id === "balanced"
      ? Array.from({ length: articleBudget(intensity) }, () => 1)
      : [...intensity.focusedArticles];

  const newsletter: Record<string, number> = {};

  preset.orderedTopicIds.slice(0, articles.length).forEach((topicId, index) => {
    newsletter[topicId] = Math.min(MAX_ARTICLES_PER_TOPIC, Math.max(1, articles[index]));
  });

  return {
    newsletter,
    miniCases: miniCasePreferenceOrder(preset).slice(0, intensity.miniCases)
  };
}

export function articleBudget(intensity: TeamIntensity): number {
  return intensity.focusedArticles.reduce((total, count) => total + count, 0);
}
