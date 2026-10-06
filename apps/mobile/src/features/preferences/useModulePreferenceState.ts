import { useAuth } from "../auth";
import type { OnboardingModuleId } from "../onboarding";
import type { ModuleFlags } from "./moduleFlags";

type ModulePreferenceState = {
  enabled: boolean;
  status: "idle" | "loading" | "ready" | "error";
};

/**
 * Whether a module tab is switched on, from memory.
 *
 * The flags are read once with the profile (AuthProvider) and replaced when
 * Settings saves them, so focusing a tab costs no request. It used to re-read
 * four preference tables on every focus of every module tab.
 */
export function useModulePreferenceState(moduleId: OnboardingModuleId): ModulePreferenceState {
  const { moduleFlags, status: authStatus, user } = useAuth();

  return resolveModulePreferenceState({
    authStatus,
    userId: user?.id ?? null,
    moduleFlags,
    moduleId
  });
}

/** Pure, so the rule is testable without React. */
export function resolveModulePreferenceState(input: {
  authStatus: string;
  userId: string | null;
  moduleFlags: ModuleFlags | null;
  moduleId: OnboardingModuleId;
}): ModulePreferenceState {
  if (input.authStatus !== "ready" || !input.userId) {
    return { enabled: true, status: "idle" };
  }

  if (!input.moduleFlags) {
    return { enabled: true, status: "loading" };
  }

  return { enabled: input.moduleFlags[input.moduleId], status: "ready" };
}
