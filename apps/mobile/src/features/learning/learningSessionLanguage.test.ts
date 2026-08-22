import { describe, expect, it } from "vitest";

import {
  localizeSessionObjectives,
  localizeSessionSummary,
  localizeSessionTitle,
  type LearningSession
} from "./learningTypes";

/**
 * A reader who switches to English gets an English Parcours.
 *
 * This file used to assert the opposite. Every screen resolved its display
 * language as `session.language ?? profileLanguage`, so a session authored while
 * the reader was French stayed French for ever — and because the whole path was
 * authored in one language, switching to English left the entire Learning Path
 * in French while the rest of the app turned over. That was the reported bug.
 *
 * The copy is stored in both languages on every session, so following the reader
 * costs nothing and needs no regeneration. `session.language` still exists and
 * still matters — it records which language the PROMPT was rendered in, which is
 * the one field that is not bilingual — but it no longer decides what is
 * displayed.
 */

describe("learning session display language follows the reader", () => {
  it("renders a French-authored session in English once the reader switches", () => {
    const session = learningSession("fr");
    const readerLanguage = "en";

    expect(localizeSessionTitle(session, readerLanguage)).toBe("English title");
    expect(localizeSessionSummary(session, readerLanguage)).toBe("English summary");
    expect(localizeSessionObjectives(session, readerLanguage)).toEqual(["English goal"]);
  });

  it("renders an English-authored session in French once the reader switches", () => {
    const session = learningSession("en");
    const readerLanguage = "fr";

    expect(localizeSessionTitle(session, readerLanguage)).toBe("Titre français");
    expect(localizeSessionSummary(session, readerLanguage)).toBe("Résumé français");
    expect(localizeSessionObjectives(session, readerLanguage)).toEqual(["Objectif français"]);
  });

  it("switches back and leaves nothing behind", () => {
    const session = learningSession("fr");

    expect(localizeSessionTitle(session, "en")).toBe("English title");
    expect(localizeSessionTitle(session, "fr")).toBe("Titre français");
    expect(localizeSessionTitle(session, "en")).toBe("English title");
  });

  it("does not read session.language when deciding what to display", () => {
    // The same reader language must produce the same output whatever language
    // the row was authored in. This is the property the screens were missing.
    for (const authored of ["fr", "en"] as const) {
      const session = learningSession(authored);

      expect(localizeSessionTitle(session, "en")).toBe("English title");
      expect(localizeSessionSummary(session, "en")).toBe("English summary");
      expect(localizeSessionObjectives(session, "en")).toEqual(["English goal"]);
    }
  });

  it("still records which language the prompt was rendered in", () => {
    // The one field that is not bilingual. The database requeues a
    // not-yet-completed session when the reader switches, so the orchestrator
    // re-renders this in the new language; a completed session keeps its
    // original prompt as a record of the work the reader actually did.
    expect(learningSession("fr").language).toBe("fr");
    expect(learningSession("fr").prompt_text).toBe("Prompt français");
    expect(learningSession("en").prompt_text).toBe("English prompt");
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
