import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type PropsWithChildren
} from "react";

import type { Language, TopicId } from "../../types/domain";
import { clampNewsletterArticleCount, isNewsletterTopicId } from "./options";

export type OnboardingState = {
  language: Language | null;
  selectedTopics: TopicId[];
  articlesPerTopic: Partial<Record<TopicId, number>>;
  placeholderSaved: boolean;
};

type OnboardingContextValue = {
  state: OnboardingState;
  setLanguage: (language: Language) => void;
  toggleTopic: (topicId: TopicId) => void;
  setArticleCount: (topicId: TopicId, count: number) => void;
  savePlaceholder: () => void;
};

type OnboardingAction =
  | { type: "setLanguage"; language: Language }
  | { type: "toggleTopic"; topicId: TopicId }
  | { type: "setArticleCount"; topicId: TopicId; count: number }
  | { type: "savePlaceholder" };

const initialState: OnboardingState = {
  language: null,
  selectedTopics: [],
  articlesPerTopic: {},
  placeholderSaved: false
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
        delete remainingCounts[action.topicId];

        return {
          ...state,
          selectedTopics: state.selectedTopics.filter((topicId) => topicId !== action.topicId),
          articlesPerTopic: remainingCounts
        };
      }

      return {
        ...state,
        selectedTopics: [...state.selectedTopics, action.topicId],
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
    case "savePlaceholder":
      return { ...state, placeholderSaved: true };
    default:
      return state;
  }
}

export function OnboardingProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(onboardingReducer, initialState);

  const setLanguage = useCallback((language: Language) => {
    dispatch({ type: "setLanguage", language });
  }, []);

  const toggleTopic = useCallback((topicId: TopicId) => {
    dispatch({ type: "toggleTopic", topicId });
  }, []);

  const setArticleCount = useCallback((topicId: TopicId, count: number) => {
    dispatch({ type: "setArticleCount", topicId, count });
  }, []);

  const savePlaceholder = useCallback(() => {
    dispatch({ type: "savePlaceholder" });
  }, []);

  const value = useMemo(
    () => ({
      state,
      setLanguage,
      toggleTopic,
      setArticleCount,
      savePlaceholder
    }),
    [savePlaceholder, setArticleCount, setLanguage, state, toggleTopic]
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
