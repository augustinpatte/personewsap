import { describe, expect, it, vi } from "vitest";

// `lib/supabase` cannot be parsed by the SSR transform, which is why every
// mobile test in this repo mocks it rather than importing it. The data modules
// below pull it in transitively; nothing here calls it, since the cache-key
// helpers are pure.
vi.mock("../../lib/supabase", () => ({
  supabase: null,
  normalizeSupabaseError: (error: unknown) => error,
  isLikelyNetworkError: () => false,
  getAuthSession: async () => ({ data: null })
}));

import { localized } from "../../lib/i18n";
import {
  getLibraryDropsCacheKey,
  getArchiveSearchCacheKey
} from "../library/libraryData";
import {
  getContentItemCacheKey,
  getTodayDropCacheKey
} from "../today/dailyDropData";
import {
  localizeSessionObjectives,
  localizeSessionSummary,
  localizeSessionTitle,
  type LearningSession
} from "../learning/learningTypes";
import { getLearningCopy } from "../learning/learningCopy";

/**
 * One reader language, everywhere.
 *
 * The reported bug was that switching French to English left the Learning Path
 * entirely French. The audit found the rest of the product was already correct —
 * Today, Library and content detail all filter on language and carry it in their
 * cache identity — and that Learning Path was the single module bound to a
 * language at creation time rather than to the reader.
 *
 * This is the cross-module guard: the same switch, checked on every module's
 * real selector, so a future change that reintroduces a language-pinned module
 * fails here rather than in someone's hands.
 */

const USER_ID = "user-1";
const DROP_DATE = "2026-08-22";

function session(authoredIn: "fr" | "en"): LearningSession {
  return {
    id: "session-1",
    path_id: "path-1",
    daily_drop_id: null,
    curriculum_step_key: "step-1",
    skipped_step_key: null,
    session_number: 1,
    adaptation_mode: "normal",
    language: authoredIn,
    title_fr: "Ce que fait vraiment un système d'exploitation",
    title_en: "What an operating system really does",
    summary_fr: "Résumé français",
    summary_en: "English summary",
    objectives_fr: ["Objectif français"],
    objectives_en: ["English goal"],
    prompt_text: authoredIn === "fr" ? "Prompt français" : "English prompt",
    generation_status: "ready",
    status: "available",
    available_on: DROP_DATE,
    opened_at: null,
    started_at: null,
    completed_at: null,
    created_at: null
  };
}

/** Every module's language-dependent identity or output, for one reader language. */
function renderEverything(language: "fr" | "en", authoredIn: "fr" | "en" = "fr") {
  const learningSession = session(authoredIn);

  return {
    // Today / Newsletter / Business Story / Mini Case all read one drop, keyed
    // by language, and the rows are filtered on language server-side.
    todayDropCacheKey: getTodayDropCacheKey(USER_ID, DROP_DATE, language),
    contentItemCacheKey: getContentItemCacheKey("content-1", { language }),
    libraryCacheKey: getLibraryDropsCacheKey(USER_ID, 20, language, null),
    archiveCacheKey: getArchiveSearchCacheKey(USER_ID, { contentType: "all", text: "", language }, 20),
    learningTitle: localizeSessionTitle(learningSession, language),
    learningSummary: localizeSessionSummary(learningSession, language),
    learningObjectives: localizeSessionObjectives(learningSession, language),
    learningCopy: getLearningCopy(language).session,
    staticCopy: localized({ en: "Today", fr: "Aujourd'hui" }, language)
  };
}

describe("switching language moves every module", () => {
  it("renders French throughout when the reader is French", () => {
    const view = renderEverything("fr");

    expect(view.learningTitle).toBe("Ce que fait vraiment un système d'exploitation");
    expect(view.learningSummary).toBe("Résumé français");
    expect(view.learningObjectives).toEqual(["Objectif français"]);
    expect(view.staticCopy).toBe("Aujourd'hui");

    for (const key of [view.todayDropCacheKey, view.contentItemCacheKey, view.libraryCacheKey]) {
      expect(key).toContain("fr");
    }
  });

  it("renders English throughout after the switch, with no French left", () => {
    const before = renderEverything("fr");
    const after = renderEverything("en");

    expect(after.learningTitle).toBe("What an operating system really does");
    expect(after.learningSummary).toBe("English summary");
    expect(after.learningObjectives).toEqual(["English goal"]);
    expect(after.staticCopy).toBe("Today");

    // Nothing rendered in the English session is the French string.
    expect(after.learningTitle).not.toBe(before.learningTitle);
    expect(after.learningSummary).not.toBe(before.learningSummary);
    expect(JSON.stringify(after.learningCopy)).not.toBe(JSON.stringify(before.learningCopy));
  });

  it("returns entirely to French when the reader switches back", () => {
    const first = renderEverything("fr");
    renderEverything("en");
    const back = renderEverything("fr");

    // Serialized: the copy bundle carries closures, which compare by reference
    // and would fail a deep equal for a reason that has nothing to do with
    // language. Every value a reader actually sees is a string or an array.
    expect(JSON.stringify(back)).toBe(JSON.stringify(first));
  });

  it("switches the Learning Path whatever language its session was authored in", () => {
    // The exact bug: a path created in French, a reader now in English.
    const authoredFrench = renderEverything("en", "fr");
    const authoredEnglish = renderEverything("en", "en");

    expect(authoredFrench.learningTitle).toBe("What an operating system really does");
    expect(authoredFrench.learningTitle).toBe(authoredEnglish.learningTitle);
    expect(authoredFrench.learningObjectives).toEqual(authoredEnglish.learningObjectives);
  });
});

describe("cached content cannot be reused across languages", () => {
  it("gives every cache a different identity per language", () => {
    const french = renderEverything("fr");
    const english = renderEverything("en");

    // A French response can never be served under the English identity, which
    // is what makes the switch safe without clearing the cache by hand.
    expect(french.todayDropCacheKey).not.toBe(english.todayDropCacheKey);
    expect(french.contentItemCacheKey).not.toBe(english.contentItemCacheKey);
    expect(french.libraryCacheKey).not.toBe(english.libraryCacheKey);
    expect(french.archiveCacheKey).not.toBe(english.archiveCacheKey);
  });

  it("keys the drop, the item, the library and the archive on language", () => {
    for (const build of [
      (language: "fr" | "en") => getTodayDropCacheKey(USER_ID, DROP_DATE, language),
      (language: "fr" | "en") => getContentItemCacheKey("content-1", { language }),
      (language: "fr" | "en") => getLibraryDropsCacheKey(USER_ID, 20, language, null),
      (language: "fr" | "en") =>
        getArchiveSearchCacheKey(USER_ID, { contentType: "all", text: "", language }, 20)
    ]) {
      expect(build("fr")).not.toBe(build("en"));
    }
  });
});
