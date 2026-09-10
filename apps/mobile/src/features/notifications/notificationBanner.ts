import type { IosPermissionStatus } from "./pushPermissionFlow";

/**
 * The in-app reminder that notifications are off.
 *
 * Teams made notifications matter more: the evening edition and the morning
 * reminder are how a reader knows the session with their friends has started.
 * So a reader who cannot receive them is told, once, briefly, and never in a
 * way that stands between them and the app: a thin banner, no modal, gone on
 * its own after five seconds, and one tap away from the Notifications section
 * of Settings.
 *
 * Everything that decides whether it appears is pure and lives here, so the
 * whole behaviour — the state logic, the five seconds, the once-per-session
 * rule — is unit tested without a device.
 */

/**
 * Whether this reader, on this device, will actually receive a push.
 *
 * Three facts, all required, none trusted alone:
 *   - iOS permission, as the system reports it right now;
 *   - `user_preferences.notifications_enabled`, the PersoNews preference;
 *   - an enabled Expo push registration in `push_tokens` for the account.
 *
 * A stored `notifications_enabled = true` with iOS permission revoked is OFF.
 * Permission granted with the PersoNews preference off is OFF. Both on with no
 * live registration is OFF — nothing can be delivered.
 */
export type EffectiveNotificationState =
  | { kind: "enabled" }
  | { kind: "disabled"; reason: "system_denied" | "preference_off" | "no_device_registration" }
  /**
   * iOS has not asked yet. The startup flow is about to show Apple's own
   * prompt, which IS the ask: a banner on top of it would be nagging.
   */
  | { kind: "awaiting_permission_prompt" }
  /**
   * Something could not be read (offline, no push on this device or build).
   * Never shown on a guess.
   */
  | { kind: "unknown" };

export function resolveEffectiveNotificationState(input: {
  /** False on a simulator, web, or a build without an EAS project id. */
  pushSupported: boolean;
  permissionStatus: IosPermissionStatus | null;
  notificationsEnabled: boolean | null;
  hasActiveDevice: boolean | null;
}): EffectiveNotificationState {
  if (
    !input.pushSupported ||
    input.permissionStatus === null ||
    input.notificationsEnabled === null ||
    input.hasActiveDevice === null
  ) {
    return { kind: "unknown" };
  }

  if (input.permissionStatus === "denied") {
    return { kind: "disabled", reason: "system_denied" };
  }

  if (input.permissionStatus === "undetermined") {
    return { kind: "awaiting_permission_prompt" };
  }

  if (!input.notificationsEnabled) {
    return { kind: "disabled", reason: "preference_off" };
  }

  if (!input.hasActiveDevice) {
    return { kind: "disabled", reason: "no_device_registration" };
  }

  return { kind: "enabled" };
}

export function shouldShowNotificationBanner(state: EffectiveNotificationState): boolean {
  return state.kind === "disabled";
}

/** Where a tap on the banner goes: the existing Settings screen, scrolled to Notifications. */
export const NOTIFICATION_SETTINGS_SECTION = "notifications";
export const NOTIFICATION_SETTINGS_TARGET = {
  pathname: "/(tabs)/settings",
  params: { section: NOTIFICATION_SETTINGS_SECTION }
} as const;

export const NOTIFICATION_BANNER_AUTO_DISMISS_MS = 5_000;

/**
 * How long the app has to stay in the background before coming back counts as
 * a new session. Short trips — to iOS Settings to switch notifications on,
 * to answer a message — continue the session they left, so the banner is not
 * shown again on return.
 */
export const NOTIFICATION_BANNER_SESSION_GAP_MS = 30 * 60 * 1_000;

export type NotificationBannerController = {
  /** A fresh reading of the effective state for the current session. */
  offer: (state: EffectiveNotificationState) => void;
  /**
   * The app changed state. Returns true when this return to the foreground
   * began a NEW session, i.e. when it is worth reading the state again.
   */
  appStateChanged: (next: string) => boolean;
  /** Hide now: a tap, or the reader navigating away. Visual only. */
  dismiss: () => void;
  isVisible: () => boolean;
  dispose: () => void;
};

/**
 * At most one banner per session, and never two at once.
 *
 * Dismissing — by the timer or a tap — is purely visual: it changes nothing
 * about the reader's notification settings and writes nothing anywhere.
 */
export function createNotificationBannerController(options: {
  onVisibilityChange: (visible: boolean) => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  autoDismissMs?: number;
  sessionGapMs?: number;
}): NotificationBannerController {
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const autoDismissMs = options.autoDismissMs ?? NOTIFICATION_BANNER_AUTO_DISMISS_MS;
  const sessionGapMs = options.sessionGapMs ?? NOTIFICATION_BANNER_SESSION_GAP_MS;

  let visible = false;
  let shownThisSession = false;
  // Apple's prompt was up during this session: the reader has just been asked
  // by the system, and whatever they answered, this session does not ask again.
  let promptedThisSession = false;
  let backgroundedAt: number | null = null;
  let timer: unknown = null;

  const setVisible = (next: boolean) => {
    if (visible === next) {
      return;
    }

    visible = next;
    options.onVisibilityChange(next);
  };

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const hide = () => {
    cancelTimer();
    setVisible(false);
  };

  return {
    offer(state) {
      if (state.kind === "awaiting_permission_prompt") {
        promptedThisSession = true;
      }

      if (!shouldShowNotificationBanner(state)) {
        // Switched on since the banner appeared: take it away now.
        hide();
        return;
      }

      if (visible || shownThisSession || promptedThisSession) {
        return;
      }

      shownThisSession = true;
      setVisible(true);
      timer = setTimer(() => {
        timer = null;
        setVisible(false);
      }, autoDismissMs);
    },

    appStateChanged(next) {
      if (next === "background") {
        backgroundedAt = now();
        // Leaving the app takes the banner with it; coming back never finds a
        // stale one waiting underneath a new one.
        hide();
        return false;
      }

      if (next !== "active" || backgroundedAt === null) {
        // `inactive` is Control Centre, a system sheet, Apple's own prompt:
        // not a new session.
        return false;
      }

      const away = now() - backgroundedAt;
      backgroundedAt = null;

      if (away < sessionGapMs) {
        return false;
      }

      shownThisSession = false;
      promptedThisSession = false;
      return true;
    },

    dismiss() {
      hide();
    },

    isVisible() {
      return visible;
    },

    dispose() {
      cancelTimer();
    }
  };
}
