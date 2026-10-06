import * as Notifications from "expo-notifications";
import { useRouter, type Href } from "expo-router";
import { useEffect, useRef } from "react";

import { useAuth } from "../auth";
import {
  canFollowNotificationRoute,
  resolveNotificationRoute,
  toNotificationNavigationTarget,
  type NotificationRoute
} from "./notificationRouting";

export type NotificationRoutingOptions = {
  /**
   * Called for every followed notification, just before navigating. Today uses
   * it to load the named edition fresh, so a tap on "your edition is here" can
   * never land on a cached "on its way".
   */
  onFollow?: (route: NotificationRoute) => void;
};

/**
 * Follows a tapped "edition is ready" notification to the Newsletter tab.
 *
 * Two entry points, both required: a tap while the app is running, and a cold
 * start where the tap is what launched the app. The cold-start response is read
 * once, and only after auth is ready — otherwise the navigation races the
 * auth/onboarding redirect and the reader lands nowhere.
 *
 * Every listener registration is guarded: notification APIs are unavailable in
 * some environments (and remote notifications are limited in Expo Go), and none
 * of that may keep the app from starting.
 */
export function useNotificationRouting(options: NotificationRoutingOptions = {}): void {
  const router = useRouter();
  // Latest callback without re-subscribing the listeners on every render.
  const onFollowRef = useRef(options.onFollow);
  onFollowRef.current = options.onFollow;
  const { status } = useAuth();
  // A cold-start tap is applied exactly once, however often this re-renders.
  const handledColdStartRef = useRef(false);

  useEffect(() => {
    if (!canFollowNotificationRoute(status)) {
      return;
    }

    let active = true;

    const follow = (data: unknown) => {
      const route = resolveNotificationRoute(data);

      if (!active || !route) {
        return;
      }

      onFollowRef.current?.(route);
      router.push(toNotificationNavigationTarget(route) as unknown as Href);
    };

    // Cold start: the notification that launched the app.
    if (!handledColdStartRef.current) {
      handledColdStartRef.current = true;

      void Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          follow(response?.notification.request.content.data);
        })
        .catch(() => {
          // No notification module, no stored response: nothing to route.
        });
    }

    let subscription: { remove: () => void } | null = null;

    try {
      subscription = Notifications.addNotificationResponseReceivedListener((response) => {
        follow(response.notification.request.content.data);
      });
    } catch {
      subscription = null;
    }

    return () => {
      active = false;
      subscription?.remove();
    };
  }, [router, status]);
}
