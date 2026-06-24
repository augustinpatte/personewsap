import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Stable loader for the versioned, single-source-of-truth editorial prompts.
 *
 * The full editorial prompts live as verbatim Markdown files under
 * `services/content-engine/prompts/`. They are NEVER copied into `dist`, so the
 * loader resolves them relative to the package root. Both the compiled module
 * (`dist/generation/promptLibrary.js`) and the TypeScript source
 * (`src/generation/promptLibrary.ts`) sit exactly two levels under the package
 * root, so the same relative path works in both runtimes.
 *
 * Important: the Markdown is loaded verbatim. The engine adapts the architecture
 * around the prompt; it never rewrites the editorial text.
 */

const PROMPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts");

export const PROMPT_FILES = {
  business_story: "business_story_prompt_final.md",
  mini_case: "mini_case_prompt_final.md"
} as const;

export type PromptFileKey = keyof typeof PROMPT_FILES;

const cache = new Map<PromptFileKey, string>();

export function loadPromptFile(key: PromptFileKey): string {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const fileName = PROMPT_FILES[key];
  const filePath = resolve(PROMPTS_DIR, fileName);

  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to load editorial prompt "${key}" from ${filePath}. ` +
        `Ensure the versioned Markdown file exists under services/content-engine/prompts/. ` +
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const trimmed = contents.trimEnd();
  if (trimmed.length === 0) {
    throw new Error(`Editorial prompt "${key}" loaded from ${filePath} is empty.`);
  }

  cache.set(key, trimmed);
  return trimmed;
}

export function promptFilePath(key: PromptFileKey): string {
  return resolve(PROMPTS_DIR, PROMPT_FILES[key]);
}

/** Full Business Story production prompt (single source of truth, loaded from Markdown). */
export const BUSINESS_STORY_PROMPT_FINAL = loadPromptFile("business_story");

/** Full Mini Case production prompt (single source of truth, loaded from Markdown). */
export const MINI_CASE_PROMPT_FINAL = loadPromptFile("mini_case");
