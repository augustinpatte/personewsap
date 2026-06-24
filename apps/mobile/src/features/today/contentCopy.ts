import type { TopicId } from "../../constants/product";
import { localized } from "../../lib/i18n";
import type {
  ContentDifficulty,
  ContentLanguage,
  DailyDropContentItem,
  KeyConcept
} from "./contentTypes";

const topicLabels: Record<ContentLanguage, Record<TopicId, string>> = {
  en: {
    business: "Markets",
    finance: "Finance & Economy",
    tech_ai: "Artificial Intelligence",
    law: "Law & Policy",
    medicine: "Health & Pharma",
    engineering: "Engineering",
    sport_business: "Sport Business",
    culture_media: "Culture & Media"
  },
  fr: {
    business: "Marchés",
    finance: "Finance & économie",
    tech_ai: "Intelligence artificielle",
    law: "Droit & politique",
    medicine: "Santé & pharma",
    engineering: "Ingénierie",
    sport_business: "Économie du sport",
    culture_media: "Culture & médias"
  }
};

export function getTopicLabel(topic: TopicId, language: ContentLanguage) {
  return topicLabels[language][topic];
}

export function getConceptCategoryLabel(concept: KeyConcept, language: ContentLanguage) {
  if (concept.category === "career") {
    return language === "fr" ? "Carrière" : "Career";
  }

  return getTopicLabel(concept.category, language);
}

export function getDifficultyLabel(difficulty: ContentDifficulty, language: ContentLanguage) {
  return localized(
    {
      en: { intro: "Accessible", intermediate: "Intermediate", advanced: "Advanced" },
      fr: { intro: "Accessible", intermediate: "Intermédiaire", advanced: "Avancé" }
    },
    language
  )[difficulty];
}

export function formatDropDate(date: string, language: ContentLanguage) {
  return new Intl.DateTimeFormat(language, {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date(`${date}T12:00:00Z`));
}

export function splitParagraphs(markdown: string) {
  return markdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function getReadableText(item: DailyDropContentItem) {
  if (item.content_type === "newsletter_article") {
    return [item.title, item.summary, item.body_md, item.why_it_matters].join(" ");
  }

  if (item.content_type === "business_story") {
    return [item.title, item.setup, item.tension, item.decision, item.outcome, item.lesson].join(
      " "
    );
  }

  if (item.content_type === "mini_case") {
    return [item.title, item.context, item.challenge, item.question, item.sample_answer].join(" ");
  }

  return [item.title, item.definition, item.plain_english, item.example, item.how_to_use_it].join(
    " "
  );
}

export function estimateReadMinutes(item: DailyDropContentItem) {
  const words = getReadableText(item).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

export function getReaderCopy(language: ContentLanguage) {
  return localized(
    {
      en: {
        close: "Back",
        minutes: (count: number) => `${count} min read`,
        newsletterEyebrow: "Newsletter",
        storyEyebrow: "Business story",
        caseEyebrow: "Mini case",
        conceptEyebrow: "Concept",
        whyItMatters: "Why it matters",
        definition: "Definition",
        inPlainEnglish: "In plain English",
        example: "Example",
        howToUse: "How to use it",
        commonMistake: "Common mistake",
        keepConcept: "Keep this concept",
        markRead: "Mark as read",
        done: "Done — back to the brief",
        back: "Back to the brief",
        lesson: "The lesson",
        // business story chapters
        setup: "The setup",
        tension: "The tension",
        decision: "The decision",
        outcome: "The outcome",
        // mini case
        context: "The situation",
        constraints: "Constraints",
        decide: "Your decision",
        chooseHint: "Pick the call you would make.",
        best: "Strongest call",
        viable: "Defensible",
        weak: "Risky",
        continue: "See the debrief",
        debrief: "Debrief",
        keyMoves: "What a sharp answer covers",
        reference: "A reference answer",
        finishCase: "Finish the case",
        // multi-question case
        questionStep: (current: number, total: number) => `Question ${current} of ${total}`,
        roleMethod: "Method",
        roleApplication: "Application",
        roleConclusion: "Conclusion",
        correct: "Correct",
        incorrect: "Not quite",
        correctAnswer: "Best answer",
        feedbackFallback: "The correct answer better matches the expected reasoning.",
        reviewBanner: "Case completed — review your reasoning.",
        reviewQuestion: (current: number) => `Question ${current}`,
        yourAnswer: "Your answer",
        next: "Continue",
        seeScore: "See your score",
        scoreEyebrow: "Your score",
        scoreValue: (score: number, total: number) => `${score}/${total}`,
        scoreMessage: (score: number, total: number) => {
          if (score === total) {
            return "Sharp judgment from start to finish.";
          }
          if (score >= Math.ceil(total / 2)) {
            return "A solid read — one or two calls worth revisiting.";
          }
          return "Worth a second look at the reasoning below.";
        },
        takeaway: "The takeaway"
      },
      fr: {
        close: "Retour",
        minutes: (count: number) => `${count} min de lecture`,
        newsletterEyebrow: "Newsletter",
        storyEyebrow: "Business story",
        caseEyebrow: "Mini cas",
        conceptEyebrow: "Concept",
        whyItMatters: "Ce que ça change",
        definition: "Définition",
        inPlainEnglish: "En clair",
        example: "Exemple",
        howToUse: "Comment l'utiliser",
        commonMistake: "Erreur fréquente",
        keepConcept: "Garder ce concept",
        markRead: "Marquer comme lu",
        done: "Terminé — retour au brief",
        back: "Retour au brief",
        lesson: "La leçon",
        setup: "Le contexte",
        tension: "La tension",
        decision: "La décision",
        outcome: "Le résultat",
        context: "La situation",
        constraints: "Contraintes",
        decide: "Votre décision",
        chooseHint: "Choisissez la décision que vous prendriez.",
        best: "Meilleur choix",
        viable: "Défendable",
        weak: "Risqué",
        continue: "Voir le débrief",
        debrief: "Débrief",
        keyMoves: "Ce qu'une bonne réponse couvre",
        reference: "Une réponse de référence",
        finishCase: "Terminer le cas",
        // multi-question case
        questionStep: (current: number, total: number) => `Question ${current} sur ${total}`,
        roleMethod: "Méthode",
        roleApplication: "Application",
        roleConclusion: "Conclusion",
        correct: "Correct",
        incorrect: "Pas tout à fait",
        correctAnswer: "Meilleure réponse",
        feedbackFallback: "La bonne réponse explique mieux le raisonnement attendu.",
        reviewBanner: "Cas terminé — vous pouvez revoir votre raisonnement.",
        reviewQuestion: (current: number) => `Question ${current}`,
        yourAnswer: "Votre réponse",
        next: "Continuer",
        seeScore: "Voir votre score",
        scoreEyebrow: "Votre score",
        scoreValue: (score: number, total: number) => `${score}/${total}`,
        scoreMessage: (score: number, total: number) => {
          if (score === total) {
            return "Un jugement net du début à la fin.";
          }
          if (score >= Math.ceil(total / 2)) {
            return "Bonne lecture — une ou deux décisions à revoir.";
          }
          return "Le raisonnement ci-dessous mérite un second regard.";
        },
        takeaway: "À retenir"
      }
    },
    language
  );
}
