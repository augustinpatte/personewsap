import * as Notifications from "expo-notifications";
import { useEffect } from "react";

import { useAuth } from "../auth";
import {
  registerCurrentDeviceForEnabledNotifications,
  syncRefreshedPushToken
} from "./pushNotificationPreferences";

/**
 * Expo push tokens can rotate while the app is installed. When that happens,
 * keep the server-side device record fresh only for a signed-in user who has
 * notifications enabled. No token value is logged.
 */
export function usePushTokenRefresh(): void {
  const { profileLanguage, status, user } = useAuth();

  useEffect(() => {
    if (status !== "ready" || !user?.id) {
      return;
    }

    void registerCurrentDeviceForEnabledNotifications({
      language: profileLanguage,
      userId: user.id
    }).catch((error: unknown) => {
      if (__DEV__) {
        console.info("[Notifications]", {
          event: "push_token_login_sync_failed",
          hasError: true,
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });

    let subscription: { remove: () => void } | null = null;

    try {
      subscription = Notifications.addPushTokenListener((token) => {
        void syncRefreshedPushToken({
          expoPushToken: token.data,
          language: profileLanguage,
          userId: user.id
        }).catch((error: unknown) => {
          if (__DEV__) {
            console.info("[Notifications]", {
              event: "push_token_refresh_sync_failed",
              hasError: true,
              message: error instanceof Error ? error.message : "Unknown error"
            });
          }
        });
      });
    } catch {
      subscription = null;
    }

    return () => {
      subscription?.remove();
    };
  }, [profileLanguage, status, user?.id]);
}
