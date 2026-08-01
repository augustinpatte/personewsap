import { localized } from "../../lib/i18n";
import type { Language } from "../../types/domain";
import type { LearningCurrentLevel, LearningTargetLevel } from "./learningTypes";

export type LearningCurrentLevelOption = {
  value: LearningCurrentLevel;
  label: string;
};

export type LearningTargetLevelOption = {
  value: LearningTargetLevel;
  label: string;
  description: string;
};

export function getCurrentLevelOptions(language: Language | null | undefined) {
  return localized<LearningCurrentLevelOption[]>(
    {
      en: [
        { value: 1, label: "No prior knowledge" },
        { value: 2, label: "Beginner" },
        { value: 3, label: "Some foundations" },
        { value: 4, label: "Intermediate" },
        { value: 5, label: "Solid understanding" },
        { value: 6, label: "Advanced" },
        { value: 7, label: "Expert" }
      ],
      fr: [
        { value: 1, label: "Aucune connaissance" },
        { value: 2, label: "Débutant" },
        { value: 3, label: "Quelques bases" },
        { value: 4, label: "Intermédiaire" },
        { value: 5, label: "Bon niveau" },
        { value: 6, label: "Avancé" },
        { value: 7, label: "Expert" }
      ]
    },
    language
  );
}

export function getTargetLevelOptions(language: Language | null | undefined) {
  return localized<LearningTargetLevelOption[]>(
    {
      en: [
        {
          value: 1,
          label: "Discover",
          description: "Understand the vocabulary and the big ideas."
        },
        {
          value: 2,
          label: "Understand",
          description: "Be able to explain the important mechanisms."
        },
        {
          value: 3,
          label: "Apply",
          description: "Use concepts in exercises and practical situations."
        },
        {
          value: 4,
          label: "Become independent",
          description: "Be able to keep learning and practising on your own."
        },
        {
          value: 5,
          label: "Reach an advanced level",
          description: "Analyse complex subjects and connect several concepts."
        }
      ],
      fr: [
        {
          value: 1,
          label: "Découvrir",
          description: "Comprendre le vocabulaire et les grandes idées."
        },
        {
          value: 2,
          label: "Comprendre",
          description: "Pouvoir expliquer les mécanismes importants."
        },
        {
          value: 3,
          label: "Appliquer",
          description: "Utiliser les concepts dans des exercices et des situations concrètes."
        },
        {
          value: 4,
          label: "Devenir autonome",
          description: "Être capable de continuer à apprendre et pratiquer seul."
        },
        {
          value: 5,
          label: "Atteindre un niveau avancé",
          description: "Analyser des sujets complexes et relier plusieurs concepts."
        }
      ]
    },
    language
  );
}

export function minimumTargetLevelForCurrentLevel(
  currentLevel: LearningCurrentLevel | null | undefined
): LearningTargetLevel {
  if (currentLevel === 3) return 2;
  if (currentLevel === 4) return 3;
  if (currentLevel === 5) return 4;
  if (currentLevel === 6 || currentLevel === 7) return 5;
  return 1;
}

export function getAllowedTargetLevelOptions(
  currentLevel: LearningCurrentLevel | null | undefined,
  language: Language | null | undefined
) {
  const minimum = minimumTargetLevelForCurrentLevel(currentLevel);
  return getTargetLevelOptions(language).filter((option) => option.value >= minimum);
}

export function getCurrentLevelLabel(
  level: LearningCurrentLevel,
  language: Language | null | undefined
) {
  return getCurrentLevelOptions(language).find((option) => option.value === level)?.label ?? String(level);
}

export function getTargetLevelLabel(
  level: LearningTargetLevel,
  language: Language | null | undefined
) {
  return getTargetLevelOptions(language).find((option) => option.value === level)?.label ?? String(level);
}
