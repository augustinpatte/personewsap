import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type PropsWithChildren
} from "react";

import type { Language } from "../../types/domain";
import {
  clampNewsletterArticleCount,
  isNewsletterTopicId,
  type NewsletterTopicId
} from "./options";

export type OnboardingState = {
  language: Language | null;
  selectedTopics: NewsletterTopicId[];
  articlesPerTopic: Partial<Record<NewsletterTopicId, number>>;
};

type OnboardingContextValue = {
  state: OnboardingState;
  setLanguage: (language: Language) => void;
  toggleTopic: (topicId: NewsletterTopicId) => void;
  setArticleCount: (topicId: NewsletterTopicId, count: number) => void;
};

type OnboardingAction =
  | { type: "setLanguage"; language: Language }
  | { type: "toggleTopic"; topicId: NewsletterTopicId }
  | { type: "setArticleCount"; topicId: NewsletterTopicId; count: number };

const initialState: OnboardingState = {
  language: null,
  selectedTopics: [],
  articlesPerTopic: {}
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction
): OnboardingState {
  switch (action.type) {
    case "setLanguage":
      return { ...state, language: action.language };
    case "toggleTopic": {
      if (!isNewsletterTopicId(action.topicId)) {
        return state;
      }

      const isSelected = state.selectedTopics.includes(action.topicId);

      if (isSelected) {
        const remainingCounts = { ...state.articlesPerTopic };
        const selectedTopics = state.selectedTopics.filter((topicId) => topicId !== action.topicId);
        delete remainingCounts[action.topicId];

        return {
          ...state,
          selectedTopics,
          articlesPerTopic: remainingCounts
        };
      }

      const selectedTopics = [...state.selectedTopics, action.topicId];

      return {
        ...state,
        selectedTopics,
        articlesPerTopic: {
          ...state.articlesPerTopic,
          [action.topicId]: state.articlesPerTopic[action.topicId] ?? 1
        }
      };
    }
    case "setArticleCount":
      if (!isNewsletterTopicId(action.topicId)) {
        return state;
      }

      return {
        ...state,
        articlesPerTopic: {
          ...state.articlesPerTopic,
          [action.topicId]: clampNewsletterArticleCount(action.count)
        }
      };
    default:
      return state;
  }
}

export function OnboardingProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(onboardingReducer, initialState);

  const setLanguage = useCallback((language: Language) => {
    dispatch({ type: "setLanguage", language });
  }, []);

  const toggleTopic = useCallback((topicId: NewsletterTopicId) => {
    dispatch({ type: "toggleTopic", topicId });
  }, []);

  const setArticleCount = useCallback((topicId: NewsletterTopicId, count: number) => {
    dispatch({ type: "setArticleCount", topicId, count });
  }, []);

  const value = useMemo(
    () => ({
      state,
      setLanguage,
      toggleTopic,
      setArticleCount
    }),
    [setArticleCount, setLanguage, state, toggleTopic]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);

  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider.");
  }

  return context;
}
