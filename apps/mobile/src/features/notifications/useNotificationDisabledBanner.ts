import { usePathname, useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useAuth } from "../auth";
import {
  createNotificationBannerController,
  NOTIFICATION_SETTINGS_TARGET,
  type EffectiveNotificationState,
  type NotificationBannerController
} from "./notificationBanner";
import { waitForStartupRegistration } from "./notificationStartup";
import { loadEffectiveNotificationState } from "./pushNotificationPreferences";

/**
 * A beat after the app opens, so the banner never flashes over the launch
 * transition and the startup registration has had its chance to run.
 */
const SETTLE_DELAY_MS = 1_200;

/**
 * Drives the disabled-notifications banner for the signed-in reader.
 *
 * Reads the effective state once when the authenticated app opens, and again
 * only when a NEW session begins (back from a long stay in the background).
 * Everything about when it may appear lives in the pure controller; this only
 * wires it to auth, AppState and the router.
 */
export function useNotificationDisabledBanner() {
  const { profileLanguage, status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const controllerRef = useRef<NotificationBannerController | null>(null);
  const onSettingsRef = useRef(false);
  const userId = status === "ready" ? (user?.id ?? null) : null;

  // Already on Settings: the banner would only point at the screen in view.
  onSettingsRef.current = pathname === "/settings" || pathname.startsWith("/settings/");

  if (controllerRef.current === null) {
    controllerRef.current = createNotificationBannerController({ onVisibilityChange: setVisible });
  }

  const evaluate = useCallback(
    async (isCancelled: () => boolean) => {
      if (!userId) {
        return;
      }

      await waitForStartupRegistration();

      if (isCancelled()) {
        return;
      }

      const state: EffectiveNotificationState = await loadEffectiveNotificationState(
        userId,
        profileLanguage
      ).catch(() => ({ kind: "unknown" as const }));

      if (isCancelled() || (onSettingsRef.current && state.kind === "disabled")) {
        return;
      }

      controllerRef.current?.offer(state);
    },
    [profileLanguage, userId]
  );

  useEffect(() => {
    if (!userId) {
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;
    const timer = setTimeout(() => {
      void evaluate(isCancelled);
    }, SETTLE_DELAY_MS);

    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (controllerRef.current?.appStateChanged(next)) {
        void evaluate(isCancelled);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [evaluate, userId]);

  useEffect(
    () => () => {
      controllerRef.current?.dispose();
    },
    []
  );

  const open = useCallback(() => {
    // Visual only: hiding the banner changes no setting.
    controllerRef.current?.dismiss();
    router.push(NOTIFICATION_SETTINGS_TARGET as unknown as Href);
  }, [router]);

  return { visible, language: profileLanguage, open };
}
