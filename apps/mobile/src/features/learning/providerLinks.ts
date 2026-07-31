import type { LearningProviderId } from "./learningTypes";

export const LEARNING_PROVIDER_LINKS: Record<LearningProviderId, { label: string; url: string }> = {
  chatgpt: {
    label: "ChatGPT",
    url: "https://chatgpt.com/"
  },
  claude: {
    label: "Claude",
    url: "https://claude.ai/"
  },
  gemini: {
    label: "Gemini",
    url: "https://gemini.google.com/app"
  }
};
