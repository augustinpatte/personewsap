import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ANALYTICS_EVENTS } from "../../lib/analytics";
import { EMPTY_DRAFT, toggleNewsletterTopic } from "./teamConfigOptions";
import { TEAM_INTENSITY_LEVELS, TEAM_PRESETS, applyTeamPreset } from "./teamPresets";
import {
  INITIAL_TEAM_SETUP,
  teamSetupCanGoBack,
  teamSetupDraft,
  teamSetupProgress,
  teamSetupReducer,
  type TeamSetupAction,
  type TeamSetupState
} from "./teamSetupFlow";
import { getTeamsCopy } from "./teamsCopy";

/**
 * The guided Team setup: the flow as a reducer (every step, every Back), and
 * the screen rules that can only be read from the screens.
 */

const teamsDir = __dirname;
const read = (file: string) => readFileSync(join(teamsDir, file), "utf8");
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const create = stripComments(read("CreateTeamScreen.tsx"));
const parts = stripComments(read("TeamSetupParts.tsx"));
const manage = stripComments(read("TeamManageScreen.tsx"));
const joinScreen = stripComments(read("JoinTeamScreen.tsx"));
const flowSource = stripComments(read("teamSetupFlow.ts"));
const presetsSource = stripComments(read("teamPresets.ts"));

const run = (...actions: TeamSetupAction[]): TeamSetupState =>
  actions.reduce(teamSetupReducer, INITIAL_TEAM_SETUP);

describe("the guided path", () => {
  it("starts on the template step, Regular already chosen", () => {
    expect(INITIAL_TEAM_SETUP.step).toBe("template");
    expect(INITIAL_TEAM_SETUP.intensityId).toBe("regular");
    expect(teamSetupProgress(INITIAL_TEAM_SETUP)).toEqual({ current: 1, total: 3 });
  });

  it("goes template → intensity → preview", () => {
    const intensity = run({ type: "choosePreset", presetId: "finance" });
    expect(intensity.step).toBe("intensity");
    expect(intensity.presetId).toBe("finance");
    expect(teamSetupProgress(intensity)).toEqual({ current: 2, total: 3 });

    const preview = teamSetupReducer(intensity, { type: "continueToPreview" });
    expect(preview.step).toBe("preview");
    expect(teamSetupProgress(preview)).toEqual({ current: 3, total: 3 });
  });

  it("changes the level only on the intensity step", () => {
    const chosen = run({ type: "choosePreset", presetId: "law" }, { type: "chooseIntensity", intensityId: "chill" });
    expect(chosen.intensityId).toBe("chill");

    // A stray dispatch elsewhere cannot change it behind the reader's back.
    expect(teamSetupReducer(INITIAL_TEAM_SETUP, { type: "chooseIntensity", intensityId: "intensive" })).toBe(
      INITIAL_TEAM_SETUP
    );
  });

  it("previews exactly what Create will submit: Finance, Regular, three topics and a case", () => {
    const preview = run({ type: "choosePreset", presetId: "finance" }, { type: "continueToPreview" });

    expect(teamSetupDraft(preview)).toEqual(applyTeamPreset("finance", "regular"));
    expect(teamSetupDraft(preview)).toEqual({
      newsletter: { finance: 1, business: 1, tech_ai: 1 },
      miniCases: ["finance_economy"]
    });
  });

  it("creates from the preview without passing through the editor", () => {
    // Finance → Continue → Create: the preview carries the name field and the
    // Create button, and Create submits teamSetupDraft(), the recommendation.
    const previewBlock = create.slice(create.indexOf('setup.step === "preview"'), create.indexOf('setup.step === "manual"'));

    expect(previewBlock).toContain("{identity}");
    expect(previewBlock).toContain("{createButton}");
    expect(create).toContain("const draft = teamSetupDraft(setup);");
    expect(create).toMatch(/saveTeamConfig\(\{[\s\S]*draftToNewsletterTopics\(draft\)[\s\S]*miniCaseTopics: draft\.miniCases/);
  });
});

describe("Back never loses a choice", () => {
  it("returns from intensity to template with the preset still marked", () => {
    const back = run({ type: "choosePreset", presetId: "medicine" }, { type: "back" });

    expect(back.step).toBe("template");
    expect(back.presetId).toBe("medicine");
  });

  it("returns from preview to intensity with the level kept", () => {
    const back = run(
      { type: "choosePreset", presetId: "medicine" },
      { type: "chooseIntensity", intensityId: "intensive" },
      { type: "continueToPreview" },
      { type: "back" }
    );

    expect(back.step).toBe("intensity");
    expect(back.intensityId).toBe("intensive");
  });

  it("keeps the level when a different subject is chosen", () => {
    const switched = run(
      { type: "choosePreset", presetId: "medicine" },
      { type: "chooseIntensity", intensityId: "chill" },
      { type: "back" },
      { type: "choosePreset", presetId: "law" }
    );

    expect(switched.presetId).toBe("law");
    expect(switched.intensityId).toBe("chill");
  });

  it("stays inside the flow until the first step, then leaves it", () => {
    expect(teamSetupCanGoBack(INITIAL_TEAM_SETUP)).toBe(false);
    expect(teamSetupCanGoBack(run({ type: "choosePreset", presetId: "finance" }))).toBe(true);
    expect(teamSetupCanGoBack(run({ type: "buildFromScratch" }))).toBe(true);
  });

  it("is wired to Android's back button and holds the iOS swipe mid-flow", () => {
    expect(create).toContain('BackHandler.addEventListener("hardwareBackPress"');
    expect(create).toContain('dispatch({ type: "back" })');
    expect(create).toContain("<Stack.Screen options={{ gestureEnabled: !inFlow }} />");
  });
});

describe("Customize", () => {
  const preview = run(
    { type: "choosePreset", presetId: "tech_ai" },
    { type: "chooseIntensity", intensityId: "intensive" },
    { type: "continueToPreview" }
  );

  it("opens the editor prefilled with the recommendation", () => {
    const manual = teamSetupReducer(preview, { type: "customize" });

    expect(manual.step).toBe("manual");
    expect(manual.manualOrigin).toBe("customize");
    expect(manual.manualDraft).toEqual(applyTeamPreset("tech_ai", "intensive"));
    expect(teamSetupProgress(manual)).toBeNull();
  });

  it("never re-applies the preset over the reader's edits", () => {
    const manual = teamSetupReducer(preview, { type: "customize" });
    const edited = toggleNewsletterTopic(manual.manualDraft, "law");
    let state = teamSetupReducer(manual, { type: "editManual", draft: edited });

    // Actions that belong to other steps are ignored here, not re-seeding.
    for (const action of [
      { type: "chooseIntensity", intensityId: "chill" },
      { type: "continueToPreview" },
      { type: "customize" }
    ] as TeamSetupAction[]) {
      state = teamSetupReducer(state, action);
    }

    expect(state.manualDraft).toEqual(edited);
    expect(teamSetupDraft(state)).toEqual(edited);
  });

  it("returns to the recommendation as it was confirmed", () => {
    const manual = teamSetupReducer(preview, { type: "customize" });
    const edited = teamSetupReducer(manual, {
      type: "editManual",
      draft: toggleNewsletterTopic(manual.manualDraft, "law")
    });
    const back = teamSetupReducer(edited, { type: "back" });

    expect(back.step).toBe("preview");
    expect(teamSetupDraft(back)).toEqual(applyTeamPreset("tech_ai", "intensive"));
  });

  it("is offered on the preview and never required", () => {
    expect(create).toContain("copy.setupCustomize");
    expect(create).toContain('dispatch({ type: "customize" })');
  });
});

describe("Build from scratch", () => {
  it("goes straight to an empty editor, without an intensity step", () => {
    const scratch = run({ type: "buildFromScratch" });

    expect(scratch.step).toBe("manual");
    expect(scratch.presetId).toBeNull();
    expect(scratch.manualOrigin).toBe("scratch");
    expect(teamSetupDraft(scratch)).toEqual(EMPTY_DRAFT);
  });

  it("clears a preset that had been picked before", () => {
    expect(run({ type: "choosePreset", presetId: "finance" }, { type: "back" }, { type: "buildFromScratch" }).presetId).toBeNull();
  });

  it("goes back to the templates, and keeps its topics if the reader returns", () => {
    const built = run(
      { type: "buildFromScratch" },
      { type: "editManual", draft: toggleNewsletterTopic(EMPTY_DRAFT, "law") }
    );
    const back = teamSetupReducer(built, { type: "back" });
    expect(back.step).toBe("template");

    expect(teamSetupReducer(back, { type: "buildFromScratch" }).manualDraft).toEqual(built.manualDraft);
  });

  it("is the same full editor as before: every topic, both counts, the mini cases", () => {
    const manualBlock = create.slice(create.indexOf('setup.step === "manual"'));

    expect(manualBlock).toContain("<TeamConfigFields");
    expect(manualBlock).toContain("draft={setup.manualDraft}");
    expect(create).toContain("onBuildFromScratch");
    // The editor itself is untouched by presets.
    expect(read("TeamConfigFields.tsx")).not.toMatch(/preset|intensity/i);
  });

  it("still refuses a Team with nothing to play", () => {
    expect(create).toContain("draftHasAGame(draft)");
    expect(create).toContain("copy.gamesRequired");
  });
});

describe("what stays out of scope", () => {
  it("never asks someone joining a Team for a preset or a level", () => {
    expect(joinScreen).not.toMatch(/preset|intensity|teamSetup/i);
  });

  it("adds no RPC, no table and no stored preset", () => {
    for (const source of [flowSource, presetsSource, parts]) {
      expect(source).not.toMatch(/supabase|\.rpc\(|teamsData/);
    }
    // The Team is written by the same two calls as before, and nothing else.
    expect(create.match(/await (createTeam|saveTeamConfig|uploadTeamAvatar|setTeamAvatar)\(/g)).toEqual([
      "await createTeam(",
      "await saveTeamConfig(",
      "await uploadTeamAvatar(",
      "await setTeamAvatar("
    ]);
    expect(create).not.toMatch(/presetId[^\n]*saveTeamConfig|team_type|preset_id/);
  });
});

describe("an existing Team", () => {
  it("opens Manage on its real, pending configuration, with the preset panel closed", () => {
    expect(manage).toContain('fetchTeamConfig({ teamId, scope: "pending" })');
    expect(manage).toContain("const [presetOpen, setPresetOpen] = useState(false);");
  });

  it("only replaces the draft on screen, after a confirmation, and saves nothing", () => {
    const applyAt = manage.indexOf("onApply=");
    const onApply = manage.slice(applyAt, manage.indexOf("onClose=", applyAt));

    expect(onApply).toContain("setDraft(next)");
    expect(onApply).not.toMatch(/saveTeamConfig|onSaveConfig/);
    expect(parts).toMatch(/Alert\.alert\(copy\.presetReplaceConfirmTitle, copy\.presetReplaceConfirmBody/);
    expect(parts).toMatch(/text: copy\.presetReplaceConfirm, onPress: \(\) => onApply\(recommendation\)/);
  });

  it("still says when a saved change takes effect, before Save", () => {
    const panelAt = manage.indexOf("<TeamPresetPanel");
    const labelAt = manage.indexOf("{effectiveLabel}");
    const saveAt = manage.indexOf("label={copy.saveConfig}");

    expect(panelAt).toBeGreaterThan(-1);
    expect(labelAt).toBeGreaterThan(panelAt);
    expect(saveAt).toBeGreaterThan(labelAt);
  });
});

describe("the edition in flight", () => {
  it("is still protected by the server: Create and Manage save through update_team_config", () => {
    const data = stripComments(read("teamsData.ts"));
    expect(data).toContain('.rpc("update_team_config"');
  });

  it("is named where a change is made", () => {
    for (const language of ["en", "fr"] as const) {
      const copy = getTeamsCopy(language);
      expect(copy.presetReplaceConfirmBody, language).toMatch(/next edition|prochaine édition/);
      expect(copy.startsNextEditionCreated, language).toMatch(/next edition|prochaine édition/);
    }

    expect(create.slice(create.indexOf('setup.step === "preview"'))).toContain("copy.startsNextEditionCreated");
  });
});

describe("copy", () => {
  const en = getTeamsCopy("en");
  const fr = getTeamsCopy("fr");

  it("names and describes every preset and level in both languages", () => {
    for (const copy of [en, fr]) {
      expect(Object.keys(copy.presets)).toEqual(TEAM_PRESETS.map((preset) => preset.id));
      expect(Object.keys(copy.intensities)).toEqual(TEAM_INTENSITY_LEVELS.map((level) => level.id));

      for (const text of [...Object.values(copy.presets), ...Object.values(copy.intensities)]) {
        expect(text.name.length).toBeGreaterThan(0);
        expect(text.body.length).toBeGreaterThan(0);
        expect(text.body.length).toBeLessThanOrEqual(70);
      }
    }
  });

  it("is written in French, not left in English", () => {
    expect(fr.setupTemplateTitle).toBe("Que veut suivre votre Team ?");
    expect(fr.setupIntensityTitle).toBe("À quel rythme voulez-vous jouer ?");
    expect(fr.intensities.regular.name).toBe("Régulier");
    expect(fr.presets.balanced.name).toBe("Équilibré");

    for (const key of ["setupTemplateBody", "setupPreviewTitle", "setupCustomize", "presetStart"] as const) {
      expect(fr[key], key).not.toBe(en[key]);
    }

    for (const id of ["tech_ai", "law", "medicine", "engineering", "sport_business", "culture_media", "balanced"] as const) {
      expect(fr.presets[id].body, id).not.toBe(en.presets[id].body);
    }
  });

  it("uses the product's words, not the implementation's", () => {
    const all = JSON.stringify([en, fr]).toLowerCase();

    for (const jargon of ["topic id", "cardinality", "allocation", "config version", "template_id", "mode"]) {
      expect(all, jargon).not.toContain(jargon);
    }
  });

  it("states the edition's volume in plain words", () => {
    expect(en.setupEditionShape(3, 1)).toBe("3 articles · 1 mini case");
    expect(en.setupEditionShape(6, 2)).toBe("6 articles · 2 mini cases");
    expect(fr.setupEditionShape(3, 1)).toBe("3 articles · 1 mini cas");
    expect(en.setupStep(2, 3)).toBe("Step 2 of 3");
    expect(fr.setupStep(2, 3)).toBe("Étape 2 sur 3");
  });
});

describe("accessibility", () => {
  it("announces every preset as a button with its selection and what it covers", () => {
    const tile = parts.slice(parts.indexOf("function PresetTile"), parts.indexOf("export function IntensityOptions"));

    expect(tile).toContain('accessibilityRole="button"');
    expect(tile).toContain("accessibilityState={{ selected }}");
    expect(tile).toContain("accessibilityLabel={text.name}");
    // What it covers, preceded by "Recommended for you" on the recommended tile.
    expect(tile).toContain(
      "accessibilityHint={recommended ? `${copy.setupRecommendedForYou}. ${text.body}` : text.body}"
    );
  });

  it("groups the levels as one choice, each announcing whether it is selected", () => {
    expect(parts).toContain('accessibilityRole="radiogroup"');
    expect(parts).toContain("selected={selectedId === level.id}");
    expect(read("../onboarding/SelectableCard.tsx")).toContain("accessibilityState={{ selected, disabled }}");
  });

  it("labels Back and Build from scratch, and marks each step title as a header", () => {
    expect(parts).toContain("accessibilityLabel={copy.setupBack}");
    expect(parts).toContain("accessibilityLabel={copy.setupScratchTitle}");
    expect(parts).toContain('accessibilityRole="header"');
  });

  it("keeps every tap target at least 44pt tall", () => {
    for (const [name, minHeight] of [...parts.matchAll(/(\w+): \{[^}]*?minHeight: (\d+)/g)].map(
      (match) => [match[1], Number(match[2])] as const
    )) {
      if (name === "headerTop" || name === "tileWide") continue;
      expect(minHeight, name).toBeGreaterThanOrEqual(44);
    }
  });
});

describe("light and dark", () => {
  it("takes every colour from the theme, never a literal", () => {
    expect(parts).toContain("useThemedStyles(createStyles)");
    expect(parts).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/);
    expect(create).not.toMatch(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/);
  });

  it("draws icons with the app's own icon badge, and no emoji", () => {
    expect(parts).toContain("<IconBadge name={preset.icon}");
    expect(JSON.stringify([getTeamsCopy("en"), getTeamsCopy("fr")])).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("analytics", () => {
  it("registers the four setup events and sends the preset only as an id", () => {
    for (const event of [
      "team_preset_selected",
      "team_intensity_selected",
      "team_preset_customized",
      "team_created_from_preset"
    ]) {
      expect(ANALYTICS_EVENTS, event).toContain(event);
    }

    for (const call of create.match(/trackAnalyticsEvent\([\s\S]*?\}\)/g) ?? []) {
      expect(call).not.toMatch(/name|teamId|team_id|email|username/);
    }
  });
});
