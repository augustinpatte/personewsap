import { localizedOrNull } from "../../lib/i18n";
import type { Language } from "../../types/domain";

/**
 * The only words the launch screen has, and none of them are drawn.
 *
 * The screen shows the "PN" mark alone: no word mark, no tagline, no slogan.
 * What is left here is the spinner's accessibility label, which a screen reader
 * announces while the app works out who is reading.
 *
 * `localizedOrNull` rather than `localized`: on a cold start the profile that
 * carries the language has not arrived yet, and `localized` resolves an unknown
 * language to English — which is exactly how a French account came to be
 * greeted by "Loading your session". Returning null lets the screen stay
 * language-neutral instead of guessing, and an unlabelled spinner is better
 * than one labelled in the wrong language.
 */
export function getLaunchCopy(language: Language | null | undefined) {
  return localizedOrNull(
    {
      en: {
        loadingAccessibilityLabel: "Loading PersoNewsAP"
      },
      fr: {
        loadingAccessibilityLabel: "Chargement de PersoNewsAP"
      }
    },
    language
  );
}
