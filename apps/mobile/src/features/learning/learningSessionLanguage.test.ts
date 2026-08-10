import { describe, expect, it } from "vitest";

import {
  localizeSessionObjectives,
  localizeSessionSummary,
  localizeSessionTitle,
  type LearningSession
} from "./learningTypes";

describe("learning session language", () => {
  it("keeps historical session copy in the session language after the profile language changes", () => {
    const session = learningSession("en");
    const profileLanguage = "fr";
    const sessionLanguage = session.language ?? profileLanguage;

    expect(localizeSessionTitle(session, sessionLanguage)).toBe("English title");
    expect(localizeSessionSummary(session, sessionLanguage)).toBe("English summary");
    expect(localizeSessionObjectives(session, sessionLanguage)).toEqual(["English goal"]);
  });

  it("uses French session copy for a historical French session after the profile language changes", () => {
    const session = learningSession("fr");
    const profileLanguage = "en";
    const sessionLanguage = session.language ?? profileLanguage;

    expect(localizeSessionTitle(session, sessionLanguage)).toBe("Titre français");
    expect(localizeSessionSummary(session, sessionLanguage)).toBe("Résumé français");
    expect(localizeSessionObjectives(session, sessionLanguage)).toEqual(["Objectif français"]);
  });
});

function learningSession(language: "fr" | "en"): LearningSession {
  return {
    id: "session-1",
    path_id: "path-1",
    daily_drop_id: null,
    curriculum_step_key: "step-1",
    skipped_step_key: null,
    session_number: 1,
    adaptation_mode: "normal",
    language,
    title_fr: "Titre français",
    title_en: "English title",
    summary_fr: "Résumé français",
    summary_en: "English summary",
    objectives_fr: ["Objectif français"],
    objectives_en: ["English goal"],
    prompt_text: language === "fr" ? "Prompt français" : "English prompt",
    generation_status: "ready",
    status: "completed",
    available_on: "2026-08-01",
    opened_at: "2026-08-01T09:00:00Z",
    started_at: "2026-08-01T09:01:00Z",
    completed_at: "2026-08-01T09:05:00Z",
    created_at: "2026-08-01T09:00:00Z"
  };
}
