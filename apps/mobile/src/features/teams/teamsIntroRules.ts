/**
 * The Teams introduction's rules, free of React, of the network and of storage.
 *
 * Three parts — how to play, how points work, how Teams count an answer —
 * shown once, the first time a reader opens Teams, and on demand from "How
 * scoring works". Whether it has been finished is a per-reader fact held on the
 * server (profiles.teams_intro_completed_at), mirrored on the device so that a
 * completion whose server write has not landed yet is not asked for twice.
 */

export const TEAMS_INTRO_STEPS = ["play", "points", "teams"] as const;

export type TeamsIntroStep = (typeof TEAMS_INTRO_STEPS)[number];

/** first_open finishes the introduction for good; manual only closes it. */
export type TeamsIntroMode = "first_open" | "manual";

export type TeamsIntroServerState = "completed" | "pending" | "unknown";

/** "How scoring works" opens on the points, the part it is named after. */
export const SCORING_STEP_INDEX = TEAMS_INTRO_STEPS.indexOf("points");

export function clampIntroStep(index: number): number {
  const whole = Number.isFinite(index) ? Math.trunc(index) : 0;
  return Math.min(Math.max(whole, 0), TEAMS_INTRO_STEPS.length - 1);
}

export function teamsIntroReducer(index: number, action: { type: "continue" | "back" }): number {
  return clampIntroStep(action.type === "continue" ? index + 1 : index - 1);
}

export function isLastIntroStep(index: number): boolean {
  return index >= TEAMS_INTRO_STEPS.length - 1;
}

/** Per reader: two people sharing a phone each get their own introduction. */
export function teamsIntroStorageKey(userId: string): string {
  return `personewsap:teams-intro-completed:v1:${userId}`;
}

/**
 * Open Teams on the introduction?
 *
 * Only when nothing says this reader finished it: not the server (any device,
 * any reinstall), not this device (a completion whose server write has not
 * landed yet). "unknown" — offline, or a database without the column yet — does
 * show it: a first visit is worth explaining, and finishing it is remembered on
 * the device at once.
 */
export function shouldShowTeamsIntro(input: {
  server: TeamsIntroServerState;
  completedOnDevice: boolean;
}): boolean {
  return !input.completedOnDevice && input.server !== "completed";
}
