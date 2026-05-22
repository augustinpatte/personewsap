import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type PropsWithChildren
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Language } from "../../types/domain";
import {
  clampNewsletterArticleCount,
  isMiniCaseTopicId,
  isNewsletterTopicId,
  MAX_MINI_CASE_TOPICS,
  normalizeMiniCaseTopics,
  normalizeNewsletterTopics,
  type MiniCaseTopicId,
  type NewsletterTopicId
} from "./options";

export type OnboardingState = {
  language: Language | null;
  selectedTopics: NewsletterTopicId[];
  selectedMiniCaseTopics: MiniCaseTopicId[];
  articlesPerTopic: Partial<Record<NewsletterTopicId, number>>;
  newsletterConfigurationComplete: boolean;
};

type OnboardingContextValue = {
  hydrated: boolean;
  restoredFromStorage: boolean;
  state: OnboardingState;
  setLanguage: (language: Language) => void;
  toggleTopic: (topicId: NewsletterTopicId) => void;
  toggleMiniCaseTopic: (topicId: MiniCaseTopicId) => void;
  setArticleCount: (topicId: NewsletterTopicId, count: number) => void;
  completeNewsletterConfiguration: () => void;
};

type OnboardingAction =
  | { type: "restoreState"; state: OnboardingState }
  | { type: "setLanguage"; language: Language }
  | { type: "toggleTopic"; topicId: NewsletterTopicId }
  | { type: "toggleMiniCaseTopic"; topicId: MiniCaseTopicId }
  | { type: "setArticleCount"; topicId: NewsletterTopicId; count: number }
  | { type: "completeNewsletterConfiguration" };

const ONBOARDING_DRAFT_STORAGE_KEY = "personewsap:onboarding-draft:v1";

const initialState: OnboardingState = {
  language: null,
  selectedTopics: [],
  selectedMiniCaseTopics: [],
  articlesPerTopic: {},
  newsletterConfigurationComplete: false
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction
): OnboardingState {
  switch (action.type) {
    case "restoreState":
      return action.state;
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
          articlesPerTopic: remainingCounts,
          newsletterConfigurationComplete: false
        };
      }

      const selectedTopics = [...state.selectedTopics, action.topicId];

      return {
        ...state,
        newsletterConfigurationComplete: false,
        selectedTopics,
        articlesPerTopic: {
          ...state.articlesPerTopic,
          [action.topicId]: state.articlesPerTopic[action.topicId] ?? 1
        }
      };
    }
    case "toggleMiniCaseTopic": {
      if (!isMiniCaseTopicId(action.topicId)) {
        return state;
      }

      const isSelected = state.selectedMiniCaseTopics.includes(action.topicId);

      if (isSelected) {
        return {
          ...state,
          selectedMiniCaseTopics: state.selectedMiniCaseTopics.filter(
            (topicId) => topicId !== action.topicId
          )
        };
      }

      if (state.selectedMiniCaseTopics.length >= MAX_MINI_CASE_TOPICS) {
        return state;
      }

      return {
        ...state,
        selectedMiniCaseTopics: [...state.selectedMiniCaseTopics, action.topicId]
      };
    }
    case "setArticleCount":
      if (!isNewsletterTopicId(action.topicId)) {
        return state;
      }

      return {
        ...state,
        newsletterConfigurationComplete: false,
        articlesPerTopic: {
          ...state.articlesPerTopic,
          [action.topicId]: clampNewsletterArticleCount(action.count)
        }
      };
    case "completeNewsletterConfiguration":
      return {
        ...state,
        newsletterConfigurationComplete: state.selectedTopics.length > 0
      };
    default:
      return state;
  }
}

export function OnboardingProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(onboardingReducer, initialState);
  const [hydrated, setHydrated] = useState(false);
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restoreDraft() {
      try {
        const storedValue = await AsyncStorage.getItem(ONBOARDING_DRAFT_STORAGE_KEY);
        const restoredState = normalizeStoredOnboardingState(storedValue);

        if (!cancelled && restoredState) {
          dispatch({ type: "restoreState", state: restoredState });
          setRestoredFromStorage(true);
        }
      } catch (error) {
        if (__DEV__) {
          console.warn("[Onboarding] Could not restore local draft", error);
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    }

    void restoreDraft();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    void AsyncStorage.setItem(ONBOARDING_DRAFT_STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const setLanguage = useCallback((language: Language) => {
    dispatch({ type: "setLanguage", language });
  }, []);

  const toggleTopic = useCallback((topicId: NewsletterTopicId) => {
    dispatch({ type: "toggleTopic", topicId });
  }, []);

  const toggleMiniCaseTopic = useCallback((topicId: MiniCaseTopicId) => {
    dispatch({ type: "toggleMiniCaseTopic", topicId });
  }, []);

  const setArticleCount = useCallback((topicId: NewsletterTopicId, count: number) => {
    dispatch({ type: "setArticleCount", topicId, count });
  }, []);

  const completeNewsletterConfiguration = useCallback(() => {
    dispatch({ type: "completeNewsletterConfiguration" });
  }, []);

  const value = useMemo(
    () => ({
      hydrated,
      restoredFromStorage,
      state,
      setLanguage,
      toggleTopic,
      toggleMiniCaseTopic,
      setArticleCount,
      completeNewsletterConfiguration
    }),
    [
      hydrated,
      completeNewsletterConfiguration,
      restoredFromStorage,
      setArticleCount,
      setLanguage,
      state,
      toggleMiniCaseTopic,
      toggleTopic
    ]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export async function clearStoredOnboardingDraft() {
  await AsyncStorage.removeItem(ONBOARDING_DRAFT_STORAGE_KEY);
}

function normalizeStoredOnboardingState(storedValue: string | null): OnboardingState | null {
  if (!storedValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(storedValue) as Partial<OnboardingState>;
    const language = parsed.language === "fr" || parsed.language === "en" ? parsed.language : null;
    const selectedTopics = normalizeNewsletterTopics(parsed.selectedTopics ?? []);
    const selectedMiniCaseTopics = normalizeMiniCaseTopics(parsed.selectedMiniCaseTopics ?? []);

    return {
      language,
      selectedTopics,
      selectedMiniCaseTopics,
      newsletterConfigurationComplete:
        Boolean(parsed.newsletterConfigurationComplete) && selectedTopics.length > 0,
      articlesPerTopic: Object.fromEntries(
        selectedTopics.map((topicId) => [
          topicId,
          clampNewsletterArticleCount(parsed.articlesPerTopic?.[topicId] ?? 1)
        ])
      ) as Partial<Record<NewsletterTopicId, number>>
    };
  } catch {
    return null;
  }
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);

  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider.");
  }

  return context;
}
