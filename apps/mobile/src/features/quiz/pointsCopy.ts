import { localized } from "../../lib/i18n";
import type { ContentLanguage } from "../today/contentTypes";
import { formatPointsLong, GRADE_MILLI, pointsFromMilli } from "./points";

/**
 * The scoring rules in words, written once and reused by Settings, the Teams
 * introduction and the "How scoring works" page — so the three can never tell
 * a reader two different things. The numbers come from points.ts, not from the
 * sentences.
 */
export function getPointsRuleCopy(language: ContentLanguage) {
  const [miss, partial, good, excellent] = GRADE_MILLI.map((milli) =>
    formatPointsLong(pointsFromMilli(milli), language)
  );

  return localized(
    {
      en: {
        lateTitle: "Answer on the edition day",
        lateRule:
          "Answer on the edition day to earn full points. You can still answer older editions, but late answers earn 50% of the normal points.",
        scale: `Every question has four defensible answers, worth ${miss}, ${partial}, ${good} or ${excellent}. Only one is worth full points, and the others are wrong in progressively more interesting ways.`
      },
      fr: {
        lateTitle: "Répondre le jour de l'édition",
        lateRule:
          "Répondez le jour de l'édition pour gagner tous les points. Vous pouvez toujours répondre aux anciennes éditions, mais les réponses tardives rapportent 50 % des points habituels.",
        scale: `Chaque question a quatre réponses défendables, valant ${miss}, ${partial}, ${good} ou ${excellent}. Une seule vaut tous les points ; les autres se trompent de façon de plus en plus intéressante.`
      }
    },
    language
  );
}
