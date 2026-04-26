import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type PropsWithChildren
} from "react";

import type { GoalId, Language, PreferenceFrequency, TopicId } from "../../types/domain";

export type OnboardingState = {
  language: Language | null;
  goal: GoalId | null;
  selectedTopics: TopicId[];
  articlesPerTopic: Partial<Record<TopicId, number>>;
  frequency: PreferenceFrequency;
  placeholderSaved: boolean;
};

type OnboardingContextValue = {
  state: OnboardingState;
  setLanguage: (language: Language) => void;
  setGoal: (goal: GoalId) => void;
  toggleTopic: (topicId: TopicId) => void;
  setArticleCount: (topicId: TopicId, count: number) => void;
  setFrequency: (frequency: PreferenceFrequency) => void;
  savePlaceholder: () => void;
};

type OnboardingAction =
  | { type: "setLanguage"; language: Language }
  | { type: "setGoal"; goal: GoalId }
  | { type: "toggleTopic"; topicId: TopicId }
  | { type: "setArticleCount"; topicId: TopicId; count: number }
  | { type: "setFrequency"; frequency: PreferenceFrequency }
  | { type: "savePlaceholder" };

const initialState: OnboardingState = {
  language: null,
  goal: null,
  selectedTopics: [],
  articlesPerTopic: {},
  frequency: "daily",
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
    case "setGoal":
      return { ...state, goal: action.goal };
    case "toggleTopic": {
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
      return {
        ...state,
        articlesPerTopic: {
          ...state.articlesPerTopic,
          [action.topicId]: Math.min(Math.max(action.count, 1), 3)
        }
      };
    case "setFrequency":
      return { ...state, frequency: action.frequency };
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

  const setGoal = useCallback((goal: GoalId) => {
    dispatch({ type: "setGoal", goal });
  }, []);

  const toggleTopic = useCallback((topicId: TopicId) => {
    dispatch({ type: "toggleTopic", topicId });
  }, []);

  const setArticleCount = useCallback((topicId: TopicId, count: number) => {
    dispatch({ type: "setArticleCount", topicId, count });
  }, []);

  const setFrequency = useCallback((frequency: PreferenceFrequency) => {
    dispatch({ type: "setFrequency", frequency });
  }, []);

  const savePlaceholder = useCallback(() => {
    dispatch({ type: "savePlaceholder" });
  }, []);

  const value = useMemo(
    () => ({
      state,
      setLanguage,
      setGoal,
      toggleTopic,
      setArticleCount,
      setFrequency,
      savePlaceholder
    }),
    [savePlaceholder, setArticleCount, setFrequency, setGoal, setLanguage, state, toggleTopic]
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
