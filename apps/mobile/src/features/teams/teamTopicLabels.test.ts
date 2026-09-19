import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { TOPIC_OPTIONS, localizeOptions } from "../onboarding/options";
import { NEWSLETTER_TOPIC_CHOICES, TEAM_TOPIC_LABELS, newsletterTopicLabel } from "./teamConfigOptions";
import { TEAM_PRESETS } from "./teamPresets";
import { getTeamsCopy } from "./teamsCopy";

/**
 * Topic names inside Teams are Teams' own — Business, Law, Engineering,
 * Medicine — while solo onboarding keeps the names it has always had. Same ids
 * underneath, two display vocabularies, and neither leaks into the other.
 */

const teamsDir = __dirname;
const read = (...segments: string[]) => readFileSync(join(teamsDir, ...segments), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CANONICAL_TOPICS = NEWSLETTER_TOPIC_CHOICES.map((choice) => choice.topicId);
const soloLabels = (language: "en" | "fr") =>
  Object.fromEntries(localizeOptions(TOPIC_OPTIONS, language).map((option) => [option.backendTopicId, option.label]));

describe("Teams topic labels", () => {
  it("are the Teams names in English", () => {
    expect(Object.fromEntries(CANONICAL_TOPICS.map((id) => [id, newsletterTopicLabel(id, "en")]))).toEqual({
      business: "Business",
      finance: "Finance",
      tech_ai: "Tech & AI",
      law: "Law",
      medicine: "Medicine",
      engineering: "Engineering",
      sport_business: "Sports Business",
      culture_media: "Culture & Media"
    });
  });

  it("are the Teams names in French", () => {
    expect(Object.fromEntries(CANONICAL_TOPICS.map((id) => [id, newsletterTopicLabel(id, "fr")]))).toEqual({
      business: "Business",
      finance: "Finance",
      tech_ai: "Tech & IA",
      law: "Droit",
      medicine: "Médecine",
      engineering: "Ingénierie",
      sport_business: "Business du sport",
      culture_media: "Culture & médias"
    });
  });

  it("no longer show the solo names that contradicted the presets", () => {
    for (const language of ["en", "fr"] as const) {
      for (const id of ["business", "law", "engineering", "medicine"]) {
        expect(newsletterTopicLabel(id, language), `${language}/${id}`).not.toBe(soloLabels(language)[id]);
      }
    }
  });

  it("match the preset of the same name", () => {
    // Pick "Law", review "Law": the preset card and the topic it leads with agree.
    for (const language of ["en", "fr"] as const) {
      const presets = getTeamsCopy(language).presets;

      for (const preset of TEAM_PRESETS.filter((entry) => entry.id !== "balanced")) {
        expect(newsletterTopicLabel(preset.id, language), `${language}/${preset.id}`).toBe(presets[preset.id].name);
      }
    }
  });
});

describe("coverage and parity", () => {
  it("cover all eight canonical topic ids, in both languages, and nothing else", () => {
    expect(CANONICAL_TOPICS).toHaveLength(8);

    for (const language of ["en", "fr"] as const) {
      expect(Object.keys(TEAM_TOPIC_LABELS[language]).sort(), language).toEqual([...CANONICAL_TOPICS].sort());
    }
  });

  it("give every id a non-empty name in each language", () => {
    for (const language of ["en", "fr"] as const) {
      for (const id of CANONICAL_TOPICS) {
        expect(newsletterTopicLabel(id, language).trim().length, `${language}/${id}`).toBeGreaterThan(0);
        expect(newsletterTopicLabel(id, language), `${language}/${id}`).not.toBe(id);
      }
    }
  });

  it("translate what French says differently, and keep what it says the same", () => {
    for (const id of ["tech_ai", "law", "medicine", "engineering", "sport_business", "culture_media"] as const) {
      expect(TEAM_TOPIC_LABELS.fr[id], id).not.toBe(TEAM_TOPIC_LABELS.en[id]);
    }

    expect(TEAM_TOPIC_LABELS.fr.business).toBe("Business");
    expect(TEAM_TOPIC_LABELS.fr.finance).toBe("Finance");
  });

  it("fall back to English, then to the id, rather than to nothing", () => {
    expect(newsletterTopicLabel("law", "de" as never)).toBe("Law");
    expect(newsletterTopicLabel("not_a_topic", "en")).toBe("not_a_topic");
  });
});

describe("solo onboarding is unchanged", () => {
  it("keeps its English labels", () => {
    expect(soloLabels("en")).toEqual({
      sport_business: "Sports",
      law: "International",
      finance: "Finance / Economy",
      business: "Stock Market",
      engineering: "Automotive Industry",
      medicine: "Pharmaceutical Industry",
      tech_ai: "Artificial Intelligence",
      culture_media: "Culture"
    });
  });

  it("keeps its French labels", () => {
    expect(soloLabels("fr")).toEqual({
      sport_business: "Sport",
      law: "International",
      finance: "Finance / Économie",
      business: "Marché actions",
      engineering: "Industrie automobile",
      medicine: "Industrie pharmaceutique",
      tech_ai: "Intelligence artificielle",
      culture_media: "Culture"
    });
  });

  it("keeps the same ids behind both vocabularies", () => {
    expect(TOPIC_OPTIONS.map((option) => option.backendTopicId)).toEqual(CANONICAL_TOPICS);
  });

  it("never reads the Teams labels", () => {
    const onboarding = stripComments(read("..", "onboarding", "options.ts"));
    const preferences = stripComments(read("..", "preferences", "PreferencesEditor.tsx"));

    for (const source of [onboarding, preferences]) {
      expect(source).not.toMatch(/TEAM_TOPIC_LABELS|newsletterTopicLabel|features\/teams|\.\.\/teams/);
    }
  });
});

describe("one label source across Teams", () => {
  const editor = stripComments(read("TeamConfigFields.tsx"));
  const setupParts = stripComments(read("TeamSetupParts.tsx"));
  const options = stripComments(read("teamConfigOptions.ts"));

  it("is used by the preset review and by the manual editor alike", () => {
    // The editor is also Manage's topic configuration: one component for both.
    expect(editor).toContain("newsletterTopicLabel(choice.topicId, language)");
    expect(setupParts).toContain("newsletterTopicLabel(topicId, language)");
    expect(read("TeamManageScreen.tsx")).toContain("<TeamConfigFields");

    for (const source of [editor, setupParts]) {
      expect(source).toMatch(/newsletterTopicLabel[\s\S]*from "\.\/teamConfigOptions"/);
      expect(source).not.toMatch(/TOPIC_OPTIONS|localizeOptions/);
    }
  });

  it("does not derive Teams names from the onboarding labels any more", () => {
    expect(options).not.toContain("localizeOptions");
    expect(options).toMatch(/return \(\s*TEAM_TOPIC_LABELS\[language\]/);
  });
});
