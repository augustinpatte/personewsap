import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createNotificationBannerController,
  NOTIFICATION_BANNER_AUTO_DISMISS_MS,
  NOTIFICATION_BANNER_SESSION_GAP_MS,
  NOTIFICATION_SETTINGS_TARGET,
  resolveEffectiveNotificationState,
  shouldShowNotificationBanner,
  type EffectiveNotificationState
} from "./notificationBanner";
import { resolveNotificationRoute } from "./notificationRouting";
import { resolveCurrentDeviceTimeZone, shouldSyncProfileTimezone } from "./profileTimezone";
import {
  decideNotificationSettingsAction,
  shouldRequestSystemPermission
} from "./pushPermissionFlow";

/**
 * The disabled-notifications banner: when it appears, how long it stays, where
 * a tap goes, and why coming back to the app never stacks a second one.
 */

const ENABLED: EffectiveNotificationState = { kind: "enabled" };
const DENIED: EffectiveNotificationState = { kind: "disabled", reason: "system_denied" };
const PREFERENCE_OFF: EffectiveNotificationState = { kind: "disabled", reason: "preference_off" };

function setup() {
  let clock = 0;
  const changes: boolean[] = [];
  const controller = createNotificationBannerController({
    onVisibilityChange: (visible) => changes.push(visible),
    now: () => clock
  });

  return {
    controller,
    changes,
    passTime: (ms: number) => {
      clock += ms;
      vi.advanceTimersByTime(ms);
    }
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the effective state is read from every fact, never one boolean", () => {
  const on = { pushSupported: true, permissionStatus: "granted", notificationsEnabled: true, hasActiveDevice: true } as const;

  it("is enabled only with permission, the PersoNews preference and a live registration", () => {
    expect(resolveEffectiveNotificationState(on)).toEqual({ kind: "enabled" });
  });

  it("is off when iOS refused, whatever the stored preference says", () => {
    expect(resolveEffectiveNotificationState({ ...on, permissionStatus: "denied" })).toEqual(DENIED);
  });

  it("is off when permission is granted but the PersoNews preference is off", () => {
    expect(resolveEffectiveNotificationState({ ...on, notificationsEnabled: false })).toEqual(PREFERENCE_OFF);
  });

  it("is off when nothing is registered to receive a push", () => {
    expect(resolveEffectiveNotificationState({ ...on, hasActiveDevice: false })).toEqual({
      kind: "disabled",
      reason: "no_device_registration"
    });
  });

  it("leaves iOS's own first prompt alone", () => {
    expect(resolveEffectiveNotificationState({ ...on, permissionStatus: "undetermined" })).toEqual({
      kind: "awaiting_permission_prompt"
    });
  });

  it("never guesses: unreadable or unsupported is unknown", () => {
    expect(resolveEffectiveNotificationState({ ...on, pushSupported: false }).kind).toBe("unknown");
    expect(resolveEffectiveNotificationState({ ...on, permissionStatus: null }).kind).toBe("unknown");
    expect(resolveEffectiveNotificationState({ ...on, hasActiveDevice: null }).kind).toBe("unknown");
  });

  it("shows a banner for a disabled state only", () => {
    expect(shouldShowNotificationBanner(ENABLED)).toBe(false);
    expect(shouldShowNotificationBanner({ kind: "unknown" })).toBe(false);
    expect(shouldShowNotificationBanner({ kind: "awaiting_permission_prompt" })).toBe(false);
    expect(shouldShowNotificationBanner(DENIED)).toBe(true);
    expect(shouldShowNotificationBanner(PREFERENCE_OFF)).toBe(true);
  });
});

describe("the banner", () => {
  it("is absent when notifications are effectively on", () => {
    const { controller, changes } = setup();

    controller.offer(ENABLED);

    expect(controller.isVisible()).toBe(false);
    expect(changes).toEqual([]);
  });

  it("is visible when notifications are effectively off", () => {
    const { controller, changes } = setup();

    controller.offer(DENIED);

    expect(controller.isVisible()).toBe(true);
    expect(changes).toEqual([true]);
  });

  it("dismisses itself after five seconds", () => {
    const { controller, changes, passTime } = setup();

    controller.offer(PREFERENCE_OFF);
    passTime(NOTIFICATION_BANNER_AUTO_DISMISS_MS - 1);
    expect(controller.isVisible()).toBe(true);

    passTime(1);
    expect(controller.isVisible()).toBe(false);
    expect(changes).toEqual([true, false]);
    expect(NOTIFICATION_BANNER_AUTO_DISMISS_MS).toBe(5_000);
  });

  it("opens the Notifications section of the existing Settings screen when tapped", () => {
    const { controller, changes, passTime } = setup();

    controller.offer(DENIED);
    controller.dismiss();

    expect(NOTIFICATION_SETTINGS_TARGET).toEqual({
      pathname: "/(tabs)/settings",
      params: { section: "notifications" }
    });
    expect(controller.isVisible()).toBe(false);

    // The auto-dismiss timer was cancelled with it: nothing fires later.
    passTime(NOTIFICATION_BANNER_AUTO_DISMISS_MS);
    expect(changes).toEqual([true, false]);
  });

  it("appears at most once per session", () => {
    const { controller, changes, passTime } = setup();

    controller.offer(DENIED);
    passTime(NOTIFICATION_BANNER_AUTO_DISMISS_MS);
    controller.offer(DENIED);
    controller.offer(PREFERENCE_OFF);

    expect(changes).toEqual([true, false]);
  });

  it("never stacks: foregrounding the app does not add or repeat a banner", () => {
    const { controller, changes, passTime } = setup();

    controller.offer(DENIED);
    expect(controller.appStateChanged("background")).toBe(false);
    expect(controller.isVisible()).toBe(false);

    passTime(60_000);
    expect(controller.appStateChanged("active")).toBe(false);
    controller.offer(DENIED);
    controller.offer(DENIED);

    expect(controller.isVisible()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("does not treat Control Centre or a system sheet as a new session", () => {
    const { controller } = setup();

    controller.offer(DENIED);
    controller.dismiss();

    expect(controller.appStateChanged("inactive")).toBe(false);
    expect(controller.appStateChanged("active")).toBe(false);
    controller.offer(DENIED);
    expect(controller.isVisible()).toBe(false);
  });

  it("may appear once more after a real absence, and still only once", () => {
    const { controller, changes, passTime } = setup();

    controller.offer(DENIED);
    controller.appStateChanged("background");
    passTime(NOTIFICATION_BANNER_SESSION_GAP_MS);

    expect(controller.appStateChanged("active")).toBe(true);
    controller.offer(DENIED);
    controller.offer(DENIED);

    expect(changes).toEqual([true, false, true]);
  });

  it("stays away for a session in which iOS's own prompt was just shown", () => {
    const { controller } = setup();

    controller.offer({ kind: "awaiting_permission_prompt" });
    // The reader answered "Don't Allow" a moment ago.
    controller.offer(DENIED);

    expect(controller.isVisible()).toBe(false);
  });

  it("goes away at once if notifications are switched on while it is up", () => {
    const { controller } = setup();

    controller.offer(DENIED);
    controller.offer(ENABLED);

    expect(controller.isVisible()).toBe(false);
  });
});

describe("the Notifications section of Settings", () => {
  it("never re-triggers Apple's prompt once it was refused: it offers iOS Settings", () => {
    expect(
      decideNotificationSettingsAction({
        permissionStatus: "denied",
        notificationsEnabled: true,
        hasActiveDevice: true
      })
    ).toBe("open_system_settings");
    expect(shouldRequestSystemPermission({ status: "denied", canAskAgain: false })).toBe(false);
    // Even if a platform claims it could ask again, a refusal is not re-asked.
    expect(shouldRequestSystemPermission({ status: "denied", canAskAgain: true })).toBe(false);
  });

  it("asks iOS only while it has never been answered", () => {
    expect(
      decideNotificationSettingsAction({
        permissionStatus: "undetermined",
        notificationsEnabled: false,
        hasActiveDevice: false
      })
    ).toBe("request_permission");
    expect(shouldRequestSystemPermission({ status: "undetermined", canAskAgain: true })).toBe(true);
    expect(shouldRequestSystemPermission({ status: "undetermined", canAskAgain: false })).toBe(false);
    expect(shouldRequestSystemPermission({ status: "granted", canAskAgain: true })).toBe(false);
  });

  it("re-enables PersoNews normally when permission is granted but the preference is off", () => {
    expect(
      decideNotificationSettingsAction({
        permissionStatus: "granted",
        notificationsEnabled: false,
        hasActiveDevice: false
      })
    ).toBe("enable_preference");
    expect(
      decideNotificationSettingsAction({
        permissionStatus: "granted",
        notificationsEnabled: true,
        hasActiveDevice: false
      })
    ).toBe("enable_preference");
    expect(
      decideNotificationSettingsAction({
        permissionStatus: "granted",
        notificationsEnabled: true,
        hasActiveDevice: true
      })
    ).toBe("none");
  });
});

describe("the next-morning reminder, once tapped", () => {
  it("opens the edition it is about, like the evening notification", () => {
    expect(resolveNotificationRoute({ type: "edition_answer_reminder", drop_date: "2026-09-14" })).toEqual({
      pathname: "/(tabs)/newsletter",
      dropDate: "2026-09-14"
    });
    expect(resolveNotificationRoute({ type: "edition_answer_remider", drop_date: "2026-09-14" })).toBeNull();
  });
});

describe("the reader's timezone follows them", () => {
  it("writes a new IANA zone when the device moved", () => {
    expect(
      shouldSyncProfileTimezone({ deviceTimeZone: "America/Chicago", lastSyncedTimeZone: "Europe/Paris" })
    ).toBe(true);
    expect(shouldSyncProfileTimezone({ deviceTimeZone: "Europe/Paris", lastSyncedTimeZone: null })).toBe(true);
  });

  it("reads the OS zone first, so a zone changed while the app was alive is seen", () => {
    // The engine still reports where the app was launched; the OS says Chicago.
    expect(
      resolveCurrentDeviceTimeZone({ native: () => "America/Chicago", intl: () => "Europe/Paris" })
    ).toBe("America/Chicago");
  });

  it("falls back to Intl only when the OS value is missing or unreadable", () => {
    expect(resolveCurrentDeviceTimeZone({ native: () => undefined, intl: () => "Asia/Shanghai" })).toBe(
      "Asia/Shanghai"
    );
    expect(
      resolveCurrentDeviceTimeZone({
        native: () => {
          throw new Error("native module unavailable");
        },
        intl: () => "America/New_York"
      })
    ).toBe("America/New_York");
    expect(resolveCurrentDeviceTimeZone({ native: () => "GMT+2", intl: () => "" })).toBeNull();
  });

  it("writes nothing when nothing changed, and never an offset", () => {
    expect(
      shouldSyncProfileTimezone({ deviceTimeZone: "Europe/Paris", lastSyncedTimeZone: "Europe/Paris" })
    ).toBe(false);
    expect(shouldSyncProfileTimezone({ deviceTimeZone: "GMT+2", lastSyncedTimeZone: null })).toBe(false);
    expect(shouldSyncProfileTimezone({ deviceTimeZone: "", lastSyncedTimeZone: null })).toBe(false);
    expect(shouldSyncProfileTimezone({ deviceTimeZone: undefined, lastSyncedTimeZone: null })).toBe(false);
  });
});
