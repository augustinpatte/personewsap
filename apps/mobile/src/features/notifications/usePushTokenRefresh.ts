import * as Notifications from "expo-notifications";
import { useEffect } from "react";

import { useAuth } from "../auth";
import { registerCurrentDeviceForEnabledNotifications } from "./pushNotificationPreferences";

/**
 * Notification setup for a signed-in reader, on every launch.
 *
 * Two jobs. First, permission: on a first launch iOS still reports
 * `undetermined`, and this is what makes the native Apple prompt appear —
 * granting it registers the device and turns the account preference on.
 *
 * Second, rotation: the device push token can change while the app is
 * installed. `addPushTokenListener` reports the NATIVE token (a bare APNs hex
 * string on iOS), which is not an Expo push token and must never be stored as
 * one — writing it produced device rows the Expo Push Service rejects. The
 * listener is therefore used only as a signal to re-run registration, which
 * asks Expo for the current `ExponentPushToken[...]` and stores that.
 *
 * No token value is ever logged.
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
      // The payload is the native device token and is deliberately unused: it
      // only tells us the device's token changed, so we re-register and let
      // Expo hand back the matching Expo push token.
      subscription = Notifications.addPushTokenListener(() => {
        void registerCurrentDeviceForEnabledNotifications({
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
