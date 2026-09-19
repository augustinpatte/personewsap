import { EMPTY_DRAFT, type TeamConfigDraft } from "./teamConfigOptions";
import {
  DEFAULT_TEAM_INTENSITY,
  applyTeamPreset,
  type TeamIntensityId,
  type TeamPresetId
} from "./teamPresets";

/**
 * The Create flow as data: which step is showing, what has been chosen, and
 * where Back goes. The screen renders this and dispatches to it; every rule
 * about moving between steps lives here, where it can be tested without a
 * phone.
 *
 *   template ─► intensity ─► preview ─► (Create)
 *      │                        │
 *      │                        └─► manual (Customize, prefilled) ─► (Create)
 *      └─► manual (Build from scratch, empty) ─► (Create)
 *
 * TWO DRAFTS, ON PURPOSE. The recommendation is never stored: it is recomputed
 * from (preset, intensity) whenever it is shown, so it cannot drift. The manual
 * editor has its own draft, seeded ONCE when it opens, and only the reader's
 * edits change it after that — a preset never re-applies itself over choices
 * somebody has made by hand.
 */

export type TeamSetupStep = "template" | "intensity" | "preview" | "manual";

export type TeamSetupState = {
  step: TeamSetupStep;
  /** The preset picked on the first step; null when building from scratch. */
  presetId: TeamPresetId | null;
  intensityId: TeamIntensityId;
  /** What the manual editor is showing. Only meaningful on the manual step. */
  manualDraft: TeamConfigDraft;
  /** How the manual editor was reached, which is also where its Back leads. */
  manualOrigin: "scratch" | "customize" | null;
};

export type TeamSetupAction =
  | { type: "choosePreset"; presetId: TeamPresetId }
  | { type: "buildFromScratch" }
  | { type: "chooseIntensity"; intensityId: TeamIntensityId }
  | { type: "continueToPreview" }
  | { type: "customize" }
  | { type: "editManual"; draft: TeamConfigDraft }
  | { type: "back" };

export const INITIAL_TEAM_SETUP: TeamSetupState = {
  step: "template",
  presetId: null,
  intensityId: DEFAULT_TEAM_INTENSITY,
  manualDraft: EMPTY_DRAFT,
  manualOrigin: null
};

export function teamSetupReducer(state: TeamSetupState, action: TeamSetupAction): TeamSetupState {
  switch (action.type) {
    case "choosePreset":
      // The intensity already chosen is kept: coming back to try another
      // subject should not also undo a level the reader had picked.
      return { ...state, step: "intensity", presetId: action.presetId };

    case "buildFromScratch":
      // Returning to scratch keeps what was built there; arriving from a
      // customized preset starts empty, because scratch means scratch.
      return {
        ...state,
        step: "manual",
        presetId: null,
        manualDraft: state.manualOrigin === "scratch" ? state.manualDraft : EMPTY_DRAFT,
        manualOrigin: "scratch"
      };

    case "chooseIntensity":
      return state.step === "intensity" ? { ...state, intensityId: action.intensityId } : state;

    case "continueToPreview":
      return state.step === "intensity" && state.presetId ? { ...state, step: "preview" } : state;

    case "customize":
      if (state.step !== "preview" || !state.presetId) {
        return state;
      }

      // Seeded once, here. Nothing after this line writes the preset back.
      return {
        ...state,
        step: "manual",
        manualDraft: applyTeamPreset(state.presetId, state.intensityId),
        manualOrigin: "customize"
      };

    case "editManual":
      return state.step === "manual" ? { ...state, manualDraft: action.draft } : state;

    case "back":
      switch (state.step) {
        case "intensity":
          return { ...state, step: "template" };
        case "preview":
          return { ...state, step: "intensity" };
        case "manual":
          // Leaving Customize returns to the recommendation as it was
          // confirmed; the hand edits were a draft of a change, not the choice.
          return state.manualOrigin === "customize"
            ? { ...state, step: "preview", manualOrigin: null, manualDraft: EMPTY_DRAFT }
            : { ...state, step: "template" };
        default:
          return state;
      }

    default:
      return state;
  }
}

/** Whether Back stays inside the flow (true) or leaves the Create screen. */
export function teamSetupCanGoBack(state: TeamSetupState): boolean {
  return state.step !== "template";
}

/** The configuration Create would submit right now. */
export function teamSetupDraft(state: TeamSetupState): TeamConfigDraft {
  if (state.step === "manual") {
    return state.manualDraft;
  }

  return state.presetId ? applyTeamPreset(state.presetId, state.intensityId) : EMPTY_DRAFT;
}

/**
 * "Step 2 of 3" on the guided path only. The manual editor is not a step of it
 * — it is the full editor, reached from two places — so it shows no counter.
 */
export function teamSetupProgress(state: TeamSetupState): { current: number; total: number } | null {
  switch (state.step) {
    case "template":
      return { current: 1, total: 3 };
    case "intensity":
      return { current: 2, total: 3 };
    case "preview":
      return { current: 3, total: 3 };
    default:
      return null;
  }
}
