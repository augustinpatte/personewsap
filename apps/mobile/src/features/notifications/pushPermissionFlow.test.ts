import { describe, expect, it } from "vitest";

import {
  decidePushPermissionAction,
  resolveNotificationSettingsState,
  shouldEnablePreferenceAfterGrant,
  type IosPermissionStatus
} from "./pushPermissionFlow";

/**
 * Why a TestFlight reader never saw Apple's permission dialog.
 *
 * Startup registration was gated on `user_preferences.notifications_enabled`,
 * which defaults to false for a new account, so a fresh install returned before
 * ever calling `requestPermissionsAsync`. iOS was never asked, no prompt was
 * shown, no token was registered, and no edition could ever be announced.
 *
 * These cases pin the whole matrix: the prompt appears exactly once, at the one
 * moment iOS allows it, and the reader's own answers govern everything after.
 */

describe("first-launch permission", () => {
  it("TEST 1: requests permission when iOS has never been asked", () => {
    // The fresh-install state: preference still false, which must NOT stop the
    // prompt — a reader cannot opt out of something never offered.
    expect(
      decidePushPermissionAction({
        permissionStatus: "undetermined",
        notificationsEnabled: false
      })
    ).toBe("request_permission");
  });

  it("asks even when the account preference is already on", () => {
    expect(
      decidePushPermissionAction({
        permissionStatus: "undetermined",
        notificationsEnabled: true
      })
    ).toBe("request_permission");
  });

  it("TEST 2: registers the device once permission is granted and wanted", () => {
    expect(
      decidePushPermissionAction({
        permissionStatus: "granted",
        notificationsEnabled: true
      })
    ).toBe("register_token");
  });

  it("TEST 3: never asks Expo for a token when iOS refused", () => {
    expect(
      decidePushPermissionAction({
        permissionStatus: "denied",
        notificationsEnabled: true
      })
    ).toBe("none");
  });

  it("TEST 16: never re-shows the native prompt after a refusal", () => {
    for (const notificationsEnabled of [true, false]) {
      expect(
        decidePushPermissionAction({ permissionStatus: "denied", notificationsEnabled })
      ).not.toBe("request_permission");
    }
  });

  it("TEST 15: does not re-prompt when permission is already granted", () => {
    for (const notificationsEnabled of [true, false]) {
      expect(
        decidePushPermissionAction({ permissionStatus: "granted", notificationsEnabled })
      ).not.toBe("request_permission");
    }

    // Registration still happens for a reader who wants notifications.
    expect(
      decidePushPermissionAction({ permissionStatus: "granted", notificationsEnabled: true })
    ).toBe("register_token");
  });

  it("respects an explicit in-app opt-out on a device iOS already allows", () => {
    expect(
      decidePushPermissionAction({
        permissionStatus: "granted",
        notificationsEnabled: false
      })
    ).toBe("none");
  });
});

describe("what a granted prompt implies for the account preference", () => {
  it("TEST 4: allowing the first-launch prompt switches the preference on", () => {
    expect(
      shouldEnablePreferenceAfterGrant({
        action: "request_permission",
        grantedStatus: "granted"
      })
    ).toBe(true);
  });

  it("does not resurrect an opt-out when merely refreshing an existing grant", () => {
    expect(
      shouldEnablePreferenceAfterGrant({ action: "register_token", grantedStatus: "granted" })
    ).toBe(false);
  });

  it("changes nothing when the prompt was refused", () => {
    for (const grantedStatus of ["denied", "undetermined"] as IosPermissionStatus[]) {
      expect(
        shouldEnablePreferenceAfterGrant({ action: "request_permission", grantedStatus })
      ).toBe(false);
    }
  });
});

describe("Settings never claims notifications work when they cannot", () => {
  it("reports the blocked state when iOS refuses but the account wants them", () => {
    expect(
      resolveNotificationSettingsState({
        permissionStatus: "denied",
        notificationsEnabled: true
      })
    ).toBe("blocked_by_ios");
  });

  it("reports plain off when the reader turned them off", () => {
    for (const permissionStatus of ["granted", "denied", "undetermined"] as IosPermissionStatus[]) {
      expect(
        resolveNotificationSettingsState({ permissionStatus, notificationsEnabled: false })
      ).toBe("off");
    }
  });

  it("reports on only when both the account and iOS agree", () => {
    expect(
      resolveNotificationSettingsState({
        permissionStatus: "granted",
        notificationsEnabled: true
      })
    ).toBe("on");
  });

  it("distinguishes a device that has not been asked yet", () => {
    expect(
      resolveNotificationSettingsState({
        permissionStatus: "undetermined",
        notificationsEnabled: true
      })
    ).toBe("needs_permission");
  });
});
