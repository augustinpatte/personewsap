export type EditionModuleKind = "newsletter" | "business_story" | "mini_case" | "learning_path";

export type EditionModuleState = {
  kind: EditionModuleKind;
  available: boolean;
  completed: boolean;
};

export type EditionModulesSummary = {
  modules: EditionModuleState[];
  total: number;
  completed: number;
  progress: number;
  isComplete: boolean;
};

/**
 * The edition total is whatever the user actually received today, never a fixed
 * number: a module only counts when it has content, and the learning path only
 * counts when it is enabled and a session is ready for this edition.
 */
export function summarizeEditionModules(input: {
  newsletterArticleCount: number;
  newsletterCompleted: boolean;
  hasBusinessStory: boolean;
  businessStoryCompleted: boolean;
  hasMiniCase: boolean;
  miniCaseCompleted: boolean;
  learningPathEnabled: boolean;
  hasReadyLearningSession: boolean;
  learningSessionCompleted: boolean;
}): EditionModulesSummary {
  const modules: EditionModuleState[] = [
    {
      kind: "newsletter",
      available: input.newsletterArticleCount > 0,
      completed: input.newsletterCompleted
    },
    {
      kind: "business_story",
      available: input.hasBusinessStory,
      completed: input.businessStoryCompleted
    },
    {
      kind: "mini_case",
      available: input.hasMiniCase,
      completed: input.miniCaseCompleted
    },
    {
      kind: "learning_path",
      available: input.learningPathEnabled && input.hasReadyLearningSession,
      completed: input.learningSessionCompleted
    }
  ];

  const availableModules = modules.filter((module) => module.available);
  const completed = availableModules.filter((module) => module.completed).length;
  const total = availableModules.length;

  return {
    modules,
    total,
    completed,
    progress: total > 0 ? completed / total : 0,
    isComplete: total > 0 && completed === total
  };
}
