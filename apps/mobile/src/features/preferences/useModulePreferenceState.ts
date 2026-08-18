import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { useAuth } from "../auth";
import type { OnboardingModuleId } from "../onboarding";
import { loadEditablePreferences } from "./preferencesPersistence";

type ModulePreferenceState = {
  enabled: boolean;
  status: "idle" | "loading" | "ready" | "error";
};

export function useModulePreferenceState(moduleId: OnboardingModuleId): ModulePreferenceState {
  const { profileLanguage, status: authStatus, user } = useAuth();
  const [state, setState] = useState<ModulePreferenceState>({
    enabled: true,
    status: "idle"
  });

  useFocusEffect(
    useCallback(() => {
      if (authStatus !== "ready" || !user?.id) {
        setState({ enabled: true, status: "idle" });
        return;
      }

      let active = true;
      setState((current) => ({ ...current, status: "loading" }));

      void loadEditablePreferences(user.id, profileLanguage)
        .then((result) => {
          if (!active) {
            return;
          }

          if (!result.ok) {
            setState({ enabled: true, status: "error" });
            return;
          }

          setState({
            enabled: result.preferences.enabledModules.includes(moduleId),
            status: "ready"
          });
        })
        .catch(() => {
          if (active) {
            setState({ enabled: true, status: "error" });
          }
        });

      return () => {
        active = false;
      };
    }, [authStatus, moduleId, profileLanguage, user?.id])
  );

  return state;
}
