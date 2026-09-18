import { useLanguage } from "@/contexts/LanguageContext";
import { landingCopy, type LandingCopy, type LandingLanguage } from "./copy";

/** The landing copy for the active language. No choice yet reads as English. */
export function useLandingCopy(): { copy: LandingCopy; lang: LandingLanguage } {
  const { language } = useLanguage();
  const lang: LandingLanguage = language === "fr" ? "fr" : "en";
  return { copy: landingCopy[lang], lang };
}
