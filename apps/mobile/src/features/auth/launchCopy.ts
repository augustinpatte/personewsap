import { localizedOrNull } from "../../lib/i18n";
import type { Language } from "../../types/domain";

/**
 * The name is not in the localized table below, deliberately: it is the same
 * word in both languages, which is what lets the launch screen show something
 * the instant it mounts, before it knows who is reading.
 */
export const BRAND_NAME = "PersoNewsAP";

/**
 * The launch copy, in the two languages the app ships.
 *
 * `localizedOrNull` rather than `localized`: on a cold start the profile that
 * carries the language has not arrived yet, and `localized` resolves an unknown
 * language to English — which is exactly how a French account came to be
 * greeted by "Loading your session". Returning null lets the screen stay
 * language-neutral instead of guessing.
 *
 * The slogan is a placeholder for a final one and is meant to be easy to
 * replace. It deliberately claims nothing absolute about the journalism ("no
 * fake news" and the like): the app has no system that would establish such a
 * guarantee.
 */
export function getLaunchCopy(language: Language | null | undefined) {
  return localizedOrNull(
    {
      en: {
        tagline: "Premium educational app",
        sloganLines: ["Learn faster.", "Read smarter."],
        loadingAccessibilityLabel: "Loading PersoNewsAP"
      },
      fr: {
        tagline: "Application éducative premium",
        sloganLines: ["Apprenez plus vite.", "Lisez plus intelligemment."],
        loadingAccessibilityLabel: "Chargement de PersoNewsAP"
      }
    },
    language
  );
}
