import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  BUSINESS_STORY_PROMPT_FINAL,
  MINI_CASE_PROMPT_FINAL,
  loadPromptFile,
  promptFilePath
} from "./promptLibrary.js";
import { CONTENT_TYPE_PROMPTS, PROMPT_SOURCES } from "./prompts.js";

describe("promptLibrary", () => {
  it("resolves the versioned Markdown files on disk", () => {
    expect(existsSync(promptFilePath("business_story"))).toBe(true);
    expect(existsSync(promptFilePath("mini_case"))).toBe(true);
  });

  it("loads the Business Story prompt verbatim with its production header and JSON contract", () => {
    expect(BUSINESS_STORY_PROMPT_FINAL).toContain(
      "# BUSINESS STORY PROMPT — VERSION PRODUCTION MOBILE EDUCATION PREMIUM"
    );
    expect(BUSINESS_STORY_PROMPT_FINAL).toContain("recent_story_memory");
    expect(BUSINESS_STORY_PROMPT_FINAL).toContain("one_line_summary");
    expect(BUSINESS_STORY_PROMPT_FINAL).toContain("FORMAT JSON OBLIGATOIRE");
  });

  it("loads the Mini Case prompt verbatim with its production header and allowed topics", () => {
    expect(MINI_CASE_PROMPT_FINAL).toContain(
      "# MINI CASE PROMPT — VERSION PRODUCTION MOBILE EDUCATION PREMIUM"
    );
    expect(MINI_CASE_PROMPT_FINAL).toContain("finance_economy");
    expect(MINI_CASE_PROMPT_FINAL).toContain("engineering_operations");
    expect(MINI_CASE_PROMPT_FINAL).toContain("recent_case_memory");
  });

  it("caches and returns identical content on repeated loads", () => {
    expect(loadPromptFile("business_story")).toBe(BUSINESS_STORY_PROMPT_FINAL);
    expect(loadPromptFile("mini_case")).toBe(MINI_CASE_PROMPT_FINAL);
  });

  it("exposes a single source of truth registry pointing at the Markdown files", () => {
    expect(PROMPT_SOURCES.business_story.editorialSpecification).toBe(BUSINESS_STORY_PROMPT_FINAL);
    expect(PROMPT_SOURCES.mini_case.editorialSpecification).toBe(MINI_CASE_PROMPT_FINAL);
    expect(PROMPT_SOURCES.business_story.file).toBe(promptFilePath("business_story"));
    expect(PROMPT_SOURCES.mini_case.file).toBe(promptFilePath("mini_case"));
  });

  it("keeps the schema-binding daily-drop output contract that validators depend on", () => {
    // The editorial direction moved to Markdown, but the schema/validator
    // anchors must remain in the output contract that wraps the daily drop.
    expect(CONTENT_TYPE_PROMPTS.mini_case).toContain("exactly 3 MCQ questions");
    expect(CONTENT_TYPE_PROMPTS.mini_case).toContain("exactly 4 options");
    expect(CONTENT_TYPE_PROMPTS.mini_case).toContain("single short feedback string");
    expect(CONTENT_TYPE_PROMPTS.mini_case).toContain("final_takeaway");
    expect(CONTENT_TYPE_PROMPTS.business_story).toContain("editorial_memory");
  });
});
