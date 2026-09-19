import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ANALYTICS_TEAM_INTENSITIES, ANALYTICS_TEAM_PRESETS } from "../../lib/analytics";
import { MINI_CASE_TOPIC_IDS } from "../onboarding/options";
import {
  MAX_ARTICLES_PER_TOPIC,
  NEWSLETTER_TOPIC_CHOICES,
  draftEditionShape,
  draftHasAGame,
  draftToNewsletterTopics
} from "./teamConfigOptions";
import {
  DEFAULT_TEAM_INTENSITY,
  TEAM_INTENSITY_LEVELS,
  TEAM_PRESETS,
  TOPIC_FAMILIES,
  applyTeamPreset,
  type TeamIntensityId,
  type TeamPresetId
} from "./teamPresets";

/**
 * Presets and intensity levels: pure data and one pure function, so every
 * property the setup flow promises is checked here without a screen.
 */

const repoRoot = join(__dirname, "..", "..", "..", "..", "..");
const read = (...segments: string[]) => readFileSync(join(repoRoot, ...segments), "utf8");

const PRESET_IDS = TEAM_PRESETS.map((preset) => preset.id);
const LEVELS = TEAM_INTENSITY_LEVELS.map((level) => level.id);
const CANONICAL_TOPICS = NEWSLETTER_TOPIC_CHOICES.map((choice) => choice.topicId);
const combos = PRESET_IDS.flatMap((presetId) => LEVELS.map((intensityId) => [presetId, intensityId] as const));
const volume = (presetId: TeamPresetId, intensityId: TeamIntensityId) => {
  const shape = draftEditionShape(applyTeamPreset(presetId, intensityId));
  return shape.articles + shape.miniCases;
};

describe("the preset catalogue", () => {
  it("has exactly the nine required presets, in order", () => {
    expect(PRESET_IDS).toEqual([
      "finance",
      "business",
      "tech_ai",
      "law",
      "medicine",
      "engineering",
      "sport_business",
      "culture_media",
      "balanced"
    ]);
  });

  it("leads every focused preset with its own topic", () => {
    for (const preset of TEAM_PRESETS.filter((entry) => entry.id !== "balanced")) {
      expect(preset.orderedTopicIds[0], preset.id).toBe(preset.id);
    }
  });

  it("keeps the requested priority order for every focused preset", () => {
    const orders = Object.fromEntries(TEAM_PRESETS.map((preset) => [preset.id, preset.orderedTopicIds]));

    expect(orders.finance).toEqual(["finance", "business", "tech_ai", "law"]);
    expect(orders.business).toEqual(["business", "finance", "tech_ai", "law"]);
    expect(orders.tech_ai).toEqual(["tech_ai", "engineering", "business", "finance"]);
    expect(orders.law).toEqual(["law", "business", "finance", "tech_ai"]);
    expect(orders.medicine).toEqual(["medicine", "tech_ai", "business", "law"]);
    expect(orders.engineering).toEqual(["engineering", "tech_ai", "business", "finance"]);
    expect(orders.sport_business).toEqual(["sport_business", "business", "finance", "culture_media"]);
    expect(orders.culture_media).toEqual(["culture_media", "business", "tech_ai", "finance"]);
  });

  it("names only the eight canonical topics the database accepts", () => {
    expect([...CANONICAL_TOPICS].sort()).toEqual(Object.keys(TOPIC_FAMILIES).sort());

    for (const preset of TEAM_PRESETS) {
      for (const topicId of preset.orderedTopicIds) {
        expect(CANONICAL_TOPICS, `${preset.id}/${topicId}`).toContain(topicId);
      }
    }
  });

  it("never lists a topic twice in one preset", () => {
    for (const preset of TEAM_PRESETS) {
      expect(new Set(preset.orderedTopicIds).size, preset.id).toBe(preset.orderedTopicIds.length);
    }
  });

  it("has an icon for every preset, and no two alike", () => {
    expect(new Set(TEAM_PRESETS.map((preset) => preset.icon)).size).toBe(TEAM_PRESETS.length);
  });
});

describe("intensity", () => {
  it("is Chill, Regular, Intensive, in that order, Regular the default", () => {
    expect(LEVELS).toEqual(["chill", "regular", "intensive"]);
    expect(DEFAULT_TEAM_INTENSITY).toBe("regular");
  });

  it("maps to the documented volumes", () => {
    // Regular is the solo shape (a few articles, one case): presets do not make
    // a Team heavier than the product already is.
    expect(draftEditionShape(applyTeamPreset("finance", "chill"))).toEqual({ articles: 2, miniCases: 1 });
    expect(draftEditionShape(applyTeamPreset("finance", "regular"))).toEqual({ articles: 3, miniCases: 1 });
    expect(draftEditionShape(applyTeamPreset("finance", "intensive"))).toEqual({ articles: 6, miniCases: 2 });
  });

  it("strictly increases the volume from one level to the next, for every preset", () => {
    for (const presetId of PRESET_IDS) {
      expect(volume(presetId, "chill"), presetId).toBeLessThan(volume(presetId, "regular"));
      expect(volume(presetId, "regular"), presetId).toBeLessThan(volume(presetId, "intensive"));
    }
  });

  it("never selects fewer topics at a higher level", () => {
    for (const presetId of PRESET_IDS) {
      const topics = LEVELS.map((level) => Object.keys(applyTeamPreset(presetId, level).newsletter).length);

      expect(topics[0], presetId).toBeLessThanOrEqual(topics[1]);
      expect(topics[1], presetId).toBeLessThanOrEqual(topics[2]);
    }
  });

  it("carries the same volume for every preset at one level", () => {
    // Intensity means one amount of play; the preset decides only what it is about.
    for (const level of LEVELS) {
      const volumes = new Set(PRESET_IDS.map((presetId) => volume(presetId, level)));
      expect(volumes.size, level).toBe(1);
    }
  });
});

describe("every generated configuration is one the backend accepts and an edition can fill", () => {
  const migration = read("supabase", "migrations", "20260906092000_teams_foundation.sql");
  const stagingBatch = read("services", "content-engine", "src", "staging", "stagingBatch.ts");

  it("rests on the constraints it was designed against", () => {
    // If any of these change, the preset numbers have to be revisited.
    expect(migration).toContain("CHECK (articles_count BETWEEN 1 AND 2)");
    expect(stagingBatch).toContain("export const EXPECTED_NEWSLETTER_JOBS = 16;");
    expect(stagingBatch).toContain("export const EXPECTED_MINI_CASE_JOBS = 6;");
    // 16 articles over 8 topics: two per topic, which is what a count of 2 takes.
    expect(16 / CANONICAL_TOPICS.length).toBe(MAX_ARTICLES_PER_TOPIC);
  });

  it.each(combos)("%s × %s", (presetId, intensityId) => {
    const draft = applyTeamPreset(presetId, intensityId);
    const level = TEAM_INTENSITY_LEVELS.find((entry) => entry.id === intensityId)!;

    expect(draftHasAGame(draft)).toBe(true);

    for (const [topicId, count] of Object.entries(draft.newsletter)) {
      expect(CANONICAL_TOPICS).toContain(topicId);
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(MAX_ARTICLES_PER_TOPIC);
    }

    // Mini cases: valid ids, no repeats (the edition has one per topic), and as
    // many as the level asks for — every preset can supply them.
    for (const miniCase of draft.miniCases) {
      expect(MINI_CASE_TOPIC_IDS).toContain(miniCase);
    }
    expect(new Set(draft.miniCases).size).toBe(draft.miniCases.length);
    expect(draft.miniCases).toHaveLength(level.miniCases);

    // Within one edition's inventory.
    expect(Object.keys(draft.newsletter).length).toBeLessThanOrEqual(CANONICAL_TOPICS.length);
    expect(draftEditionShape(draft).articles).toBeLessThanOrEqual(16);
    expect(draft.miniCases.length).toBeLessThanOrEqual(MINI_CASE_TOPIC_IDS.length);

    // What the server receives is exactly what was generated, already legal.
    expect(draftToNewsletterTopics(draft)).toEqual(
      Object.entries(draft.newsletter).map(([topicId, articlesCount]) => ({ topicId, articlesCount }))
    );
  });
});

describe("focused presets", () => {
  it("grow from the lead topic outward, as the priority list says", () => {
    expect(Object.keys(applyTeamPreset("finance", "chill").newsletter)).toEqual(["finance", "business"]);
    expect(Object.keys(applyTeamPreset("finance", "regular").newsletter)).toEqual([
      "finance",
      "business",
      "tech_ai"
    ]);
    expect(applyTeamPreset("finance", "intensive").newsletter).toEqual({
      finance: 2,
      business: 2,
      tech_ai: 1,
      law: 1
    });
  });

  it("send topics in priority order, which becomes the server's position", () => {
    expect(draftToNewsletterTopics(applyTeamPreset("medicine", "regular")).map((topic) => topic.topicId)).toEqual(
      ["medicine", "tech_ai", "business"]
    );
  });

  it("take mini cases from their own subject first", () => {
    expect(applyTeamPreset("finance", "regular").miniCases).toEqual(["finance_economy"]);
    expect(applyTeamPreset("tech_ai", "regular").miniCases).toEqual(["ai"]);
    expect(applyTeamPreset("law", "regular").miniCases).toEqual(["law_compliance"]);
    expect(applyTeamPreset("medicine", "regular").miniCases).toEqual(["health_pharma"]);
    expect(applyTeamPreset("engineering", "regular").miniCases).toEqual(["engineering_operations"]);
  });

  it("borrow cases from the next topic when their subject has none", () => {
    // Business, Sports Business and Culture & Media have no mini-case topic.
    expect(applyTeamPreset("business", "regular").miniCases).toEqual(["finance_economy"]);
    expect(applyTeamPreset("sport_business", "intensive").miniCases).toEqual(["finance_economy", "stock_market"]);
    expect(applyTeamPreset("culture_media", "regular").miniCases).toEqual(["ai"]);
  });
});

describe("Balanced", () => {
  const families = (presetId: TeamPresetId, level: TeamIntensityId) =>
    new Set(
      Object.keys(applyTeamPreset(presetId, level).newsletter).map(
        (topicId) => TOPIC_FAMILIES[topicId as keyof typeof TOPIC_FAMILIES]
      )
    );

  it("spans more domains at every level", () => {
    expect(families("balanced", "chill").size).toBe(2);
    expect(families("balanced", "regular").size).toBe(3);
    expect(families("balanced", "intensive").size).toBe(4);
  });

  it("is wider than any focused preset at the same level", () => {
    for (const level of LEVELS) {
      for (const presetId of PRESET_IDS.filter((id) => id !== "balanced")) {
        expect(families("balanced", level).size, `${presetId}/${level}`).toBeGreaterThanOrEqual(
          families(presetId, level).size
        );
      }
    }
  });

  it("is not the first topics of the catalogue", () => {
    // The catalogue opens with business, finance: two economy topics.
    expect(Object.keys(applyTeamPreset("balanced", "chill").newsletter)).not.toEqual(
      CANONICAL_TOPICS.slice(0, 2)
    );
  });

  it("spreads its volume one article per topic, over six topics at Intensive", () => {
    const intensive = applyTeamPreset("balanced", "intensive");

    expect(Object.values(intensive.newsletter).every((count) => count === 1)).toBe(true);
    expect(Object.keys(intensive.newsletter)).toHaveLength(6);
    expect(intensive.miniCases).toEqual(["ai", "law_compliance"]);
  });
});

describe("applying a preset", () => {
  it("is deterministic", () => {
    for (const [presetId, intensityId] of combos) {
      expect(applyTeamPreset(presetId, intensityId)).toEqual(applyTeamPreset(presetId, intensityId));
    }
  });

  it("returns a fresh draft each time, so editing one cannot change the next", () => {
    const first = applyTeamPreset("finance", "regular");
    first.newsletter.law = 2;
    first.miniCases.push("ai");

    expect(applyTeamPreset("finance", "regular")).toEqual({
      newsletter: { finance: 1, business: 1, tech_ai: 1 },
      miniCases: ["finance_economy"]
    });
  });

  it("produces a plain Team configuration, with no preset recorded in it", () => {
    expect(Object.keys(applyTeamPreset("law", "intensive")).sort()).toEqual(["miniCases", "newsletter"]);
  });
});

describe("analytics", () => {
  it("accepts exactly the preset and intensity ids, and nothing else", () => {
    expect([...ANALYTICS_TEAM_PRESETS]).toEqual(PRESET_IDS);
    expect([...ANALYTICS_TEAM_INTENSITIES]).toEqual(LEVELS);
  });
});
