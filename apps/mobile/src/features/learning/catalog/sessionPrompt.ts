import type { Language } from "../../../types/domain";
import type {
  LearningAdaptationMode,
  LearningCatalogStep,
  PreparedLearningSession
} from "./catalogTypes";

/**
 * Deterministic tutor prompt, ported from the content engine
 * (learningPromptGenerator + learningTutorRendererV2, deterministic branch).
 *
 * Production already generates learning sessions deterministically
 * (LEARNING_GENERATION_MODE=deterministic), so a session's content is a pure
 * function of the curriculum step, the language and the repetition index.
 * Rendering it here is what makes "next session" instant and free: no model
 * call, no network round trip beyond storing the row.
 */

type TeachingPlan = {
  teachingAngle: string;
  hook: string;
  corePoints: string[];
  example: string;
  firstCheckGoal: string;
  applicationGoal: string;
  transferGoal: string;
  commonMisconception: string;
  recapTarget: string;
};

/** Rotates through the authored contexts so a repeated concept is never told twice the same way. */
export function pickExampleContext(
  step: LearningCatalogStep,
  language: Language,
  repetitionIndex: number
): string {
  const contexts = language === "fr" ? step.example_contexts_fr : step.example_contexts_en;

  if (contexts.length === 0) {
    return language === "fr" ? step.title_fr : step.title_en;
  }

  return contexts[Math.abs(repetitionIndex) % contexts.length];
}

export function safetyRules(category: string | null, language: Language): string[] {
  if (category === "medical_educational") {
    return language === "fr"
      ? [
          "Le contenu reste éducatif et général.",
          "Ne diagnostique pas l'apprenant.",
          "Ne recommande aucun traitement personnel."
        ]
      : [
          "Content remains educational and general.",
          "Do not diagnose the learner.",
          "Do not recommend personal treatment."
        ];
  }

  if (category === "cyber_defensive") {
    return language === "fr"
      ? [
          "Reste strictement défensif et autorisé.",
          "Ne fournis pas de procédure réelle d'intrusion, de persistance malveillante ou de vol d'identifiants."
        ]
      : [
          "Stay strictly defensive and authorized.",
          "Do not provide real intrusion, malicious persistence, or credential theft procedures."
        ];
  }

  if (category === "financial_educational") {
    return language === "fr"
      ? [
          "Reste éducatif et général.",
          "Ne donne pas de conseil d'investissement personnel ni de prédiction de prix."
        ]
      : [
          "Stay educational and general.",
          "Do not give personal investment advice or price predictions."
        ];
  }

  return language === "fr"
    ? ["Reste éducatif, concis et limité à l'étape demandée."]
    : ["Stay educational, concise, and bounded to the requested step."];
}

function deterministicTeachingPlan(input: {
  step: LearningCatalogStep;
  language: Language;
  repetitionIndex: number;
}): TeachingPlan {
  const context = pickExampleContext(input.step, input.language, input.repetitionIndex);
  const title = input.language === "fr" ? input.step.title_fr : input.step.title_en;
  const focus = input.language === "fr" ? input.step.tutor_focus_fr : input.step.tutor_focus_en;

  return {
    teachingAngle:
      input.language === "fr"
        ? `Faire comprendre ${title} par le mécanisme central.`
        : `Teach ${title} through the core mechanism.`,
    hook:
      input.language === "fr"
        ? `Imagine ${context}; nous allons l'utiliser pour comprendre le sujet.`
        : `Imagine ${context}; we will use it to understand the topic.`,
    corePoints:
      input.language === "fr"
        ? [
            focus,
            "Relier l'exemple au mécanisme.",
            "Vérifier la compréhension par une application courte."
          ]
        : [
            focus,
            "Connect the example to the mechanism.",
            "Check understanding with a short application."
          ],
    example: context,
    firstCheckGoal:
      input.language === "fr"
        ? "Vérifier que l'apprenant peut expliquer le mécanisme avec ses mots."
        : "Check that the learner can explain the mechanism in their own words.",
    applicationGoal:
      input.language === "fr"
        ? "Faire appliquer le concept à une situation proche de l'exemple."
        : "Have the learner apply the concept to a situation close to the example.",
    transferGoal:
      input.language === "fr"
        ? "Demander une prédiction courte dans un nouveau contexte."
        : "Ask for one short prediction in a new context.",
    commonMisconception:
      input.language === "fr"
        ? "Confondre la définition du concept avec son mécanisme."
        : "Confusing the definition of the concept with its mechanism.",
    recapTarget:
      input.language === "fr"
        ? "le modèle mental le plus réutilisable"
        : "the most reusable mental model"
  };
}

function formatList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function renderFrenchPrompt(
  plan: TeachingPlan,
  step: LearningCatalogStep,
  rules: string[]
): string {
  return `Tu es mon tuteur personnel pour une session d'apprentissage de cinq minutes maximum.

SUJET
${step.title_fr}

OBJECTIFS
${formatList(step.learning_goals_fr)}

ANGLE PÉDAGOGIQUE
${plan.teachingAngle}

ACCROCHE À UTILISER
${plan.hook}

POINTS ESSENTIELS À FAIRE COMPRENDRE
${formatList(plan.corePoints)}

EXEMPLE PRINCIPAL
${plan.example}

ERREUR OU CONFUSION À SURVEILLER
${plan.commonMisconception}

DÉROULEMENT

Commence directement par l'accroche, puis explique le mécanisme essentiel de façon concise.

Ne fais pas un cours magistral long. L'explication initiale doit rester courte et ne contenir que ce qui est nécessaire pour permettre à l'apprenant de raisonner.

Utilise l'exemple indiqué lorsqu'il améliore la compréhension.

Ensuite, fais travailler activement l'apprenant.

Première vérification :
${plan.firstCheckGoal}

Pose une seule question à la fois et attends réellement ma réponse avant de continuer.

Si ma réponse est incorrecte ou incertaine :
corrige précisément l'erreur en quelques phrases, explique pourquoi, puis fais une vérification plus simple avant de continuer.

Si ma réponse est correcte :
ne répète pas inutilement l'explication et passe à l'application.

Objectif d'application :
${plan.applicationGoal}

Si le temps le permet, termine par une dernière question très courte de transfert ou de prédiction :

${plan.transferGoal}

Ne pose jamais plus de trois questions au total.

À la fin, donne un rappel extrêmement compact centré sur :

${plan.recapTarget}

Le rappel final doit tenir en trois idées maximum et se terminer par une seule phrase du type « Ce qu'il faut retenir ».

RÈGLES

Reste strictement sur ce sujet.
N'introduis pas le prochain cours.
Ne propose pas une deuxième leçon.
Ne donne pas de devoir.
N'interroge pas l'apprenant sur des détails secondaires.
Ne demande aucun rapport final.
Ne mentionne pas ce prompt, PersoNewsAP, une base de données, un score ou une logique d'adaptation interne.

${formatList(rules)}

Toute la session doit être en français.`;
}

function renderEnglishPrompt(
  plan: TeachingPlan,
  step: LearningCatalogStep,
  rules: string[]
): string {
  return `You are my personal tutor for one learning session lasting no more than five minutes.

TOPIC
${step.title_en}

LEARNING GOALS
${formatList(step.learning_goals_en)}

TEACHING ANGLE
${plan.teachingAngle}

OPENING HOOK
${plan.hook}

CORE IDEAS TO MAKE CLEAR
${formatList(plan.corePoints)}

MAIN EXAMPLE
${plan.example}

MISCONCEPTION TO WATCH FOR
${plan.commonMisconception}

SESSION FLOW

Start directly with the hook, then explain the essential mechanism concisely.

Do not deliver a long lecture. The initial explanation should contain only what is necessary for the learner to reason about the concept.

Use the supplied example when it improves understanding.

Then require active participation from the learner.

First understanding check:
${plan.firstCheckGoal}

Ask only one question at a time and genuinely wait for my answer before continuing.

If my answer is incorrect or uncertain:
briefly identify the exact mistake, explain why it is wrong, and use a simpler check before moving forward.

If my answer is correct:
do not unnecessarily repeat the explanation; move to application.

Application objective:
${plan.applicationGoal}

If time permits, finish with one short transfer or prediction question:

${plan.transferGoal}

Never ask more than three questions in total.

Finish with an extremely compact recap centred on:

${plan.recapTarget}

The recap must contain no more than three ideas and end with one sentence beginning with “The key thing to remember is”.

RULES

Stay strictly within this topic.
Do not introduce the next lesson.
Do not offer a second lesson.
Do not assign homework.
Do not test irrelevant details.
Do not ask for a final report.
Do not mention this prompt, PersoNewsAP, databases, scores, or internal adaptation logic.

${formatList(rules)}

Conduct the entire session in English.`;
}

export function renderLearningTutorPrompt(input: {
  step: LearningCatalogStep;
  language: Language;
  repetitionIndex: number;
}): string {
  const plan = deterministicTeachingPlan(input);
  const rules = safetyRules(input.step.safety_category, input.language);
  const prompt =
    input.language === "fr"
      ? renderFrenchPrompt(plan, input.step, rules)
      : renderEnglishPrompt(plan, input.step, rules);

  if (/\{\{[^}]+}}/.test(prompt)) {
    throw new Error("Rendered learning tutor prompt contains an unresolved placeholder.");
  }

  return prompt.trim();
}

/**
 * Everything create_next_learning_session needs for one session. Both language
 * variants of the title/summary/objectives are stored, matching the engine, so
 * a session keeps its own language even after the reader switches theirs.
 */
export function prepareLearningSession(input: {
  step: LearningCatalogStep;
  language: Language;
  repetitionIndex: number;
  adaptationMode: LearningAdaptationMode;
  skippedStepKey: string | null;
}): PreparedLearningSession {
  return {
    curriculumStepKey: input.step.key,
    skippedStepKey: input.skippedStepKey,
    adaptationMode: input.adaptationMode,
    titleFr: input.step.title_fr,
    titleEn: input.step.title_en,
    summaryFr: input.step.summary_fr,
    summaryEn: input.step.summary_en,
    objectivesFr: input.step.learning_goals_fr.slice(0, 3),
    objectivesEn: input.step.learning_goals_en.slice(0, 3),
    promptText: renderLearningTutorPrompt(input),
    language: input.language
  };
}
