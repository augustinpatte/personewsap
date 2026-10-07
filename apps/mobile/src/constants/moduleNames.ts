import type { Language } from "../types/domain";

/**
 * The product's module names — one spelling per language, used everywhere.
 *
 * Before this file the same module was "Mini cases", "Mini Cases", "Mini case",
 * "Mini cas" and "Mini-cas" depending on the screen, and Business Stories was
 * also "Business stories", "Stories" and "Histoires business". A reader cannot
 * tell whether two names mean one thing, so there is now exactly one:
 *
 *   name      the module's proper name, in titles, settings and prose
 *   singular  one item of it, as a kicker above a title ("Business Story")
 *   tab       the bottom bar's label
 *
 * THE TAB LABEL IS THE ONE DELIBERATE SHORT FORM. The bar holds five
 * destinations in a slot ~58pt wide; "Business Stories" and "Learning Path"
 * cannot fit at a readable size, so the bar says "Stories" and "Path" — the
 * same words, shortened, never a different name. Whether a tab label fits its
 * capsule is pinned by tabBarLabels.test.ts against these very strings.
 *
 * Business Stories, Newsletter and Teams are product names in both languages,
 * the way a French reader says "ma team".
 */

export type ProductModuleId =
  | "newsletter"
  | "business_story"
  | "mini_case"
  | "learning_path"
  | "teams";

export type ModuleNames = {
  name: string;
  singular: string;
  tab: string;
};

export const MODULE_NAMES: Record<Language, Record<ProductModuleId, ModuleNames>> = {
  en: {
    newsletter: { name: "Newsletter", singular: "Newsletter", tab: "Newsletter" },
    business_story: { name: "Business Stories", singular: "Business Story", tab: "Stories" },
    mini_case: { name: "Mini Cases", singular: "Mini Case", tab: "Mini Cases" },
    learning_path: { name: "Learning Path", singular: "Learning Path", tab: "Path" },
    teams: { name: "Teams", singular: "Team", tab: "Teams" }
  },
  fr: {
    newsletter: { name: "Newsletter", singular: "Newsletter", tab: "Newsletter" },
    business_story: { name: "Business Stories", singular: "Business Story", tab: "Stories" },
    mini_case: { name: "Mini-cas", singular: "Mini-cas", tab: "Mini-cas" },
    learning_path: { name: "Parcours", singular: "Parcours", tab: "Parcours" },
    teams: { name: "Teams", singular: "Team", tab: "Teams" }
  }
};

export const PRODUCT_MODULE_IDS = Object.keys(MODULE_NAMES.en) as ProductModuleId[];

export function moduleNames(language: Language | null | undefined): Record<ProductModuleId, ModuleNames> {
  return MODULE_NAMES[language === "fr" ? "fr" : "en"];
}
