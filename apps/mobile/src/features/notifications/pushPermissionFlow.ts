/**
 * What the app does about notification permission on launch.
 *
 * Two separate facts decide this, and confusing them is what left TestFlight
 * readers without a single Apple prompt:
 *
 *  - the iOS system permission, owned by the operating system;
 *  - `user_preferences.notifications_enabled`, the reader's PersoNewsAP
 *    preference, which defaults to false for a new account.
 *
 * Registration used to be gated on the preference alone, so a fresh install
 * (preference false) returned before ever reaching `requestPermissionsAsync`,
 * and iOS was never asked to show its dialog. The decision below asks the
 * system exactly once — while iOS still reports `undetermined`, which by
 * definition is the first launch — and lets the reader's own answer decide
 * everything afterwards.
 *
 * Kept pure so the whole matrix is unit tested rather than asserted against a
 * device.
 */

/** The subset of `Notifications.PermissionStatus` this decision needs. */
export type IosPermissionStatus = "undetermined" | "granted" | "denied";

export type PushPermissionAction =
  /** Show the native Apple prompt. First launch only. */
  | "request_permission"
  /** Permission is already granted and the reader wants notifications. */
  | "register_token"
  /** Nothing to do: denied by iOS, or switched off in PersoNewsAP. */
  | "none";

export function decidePushPermissionAction(input: {
  permissionStatus: IosPermissionStatus;
  /** `user_preferences.notifications_enabled` for the signed-in reader. */
  notificationsEnabled: boolean;
}): PushPermissionAction {
  if (input.permissionStatus === "undetermined") {
    // Never asked on this install. This is the one moment iOS will show its
    // dialog, and it is not conditioned on the in-app preference: a reader
    // cannot have opted out of something they were never offered.
    return "request_permission";
  }

  if (input.permissionStatus === "denied") {
    // iOS will not show the dialog again, and asking changes nothing. The
    // reader can still turn it on from Settings > PersoNewsAP.
    return "none";
  }

  // Granted. Register only if the reader still wants notifications in-app:
  // `false` here means they switched them off deliberately after granting.
  return input.notificationsEnabled ? "register_token" : "none";
}

/**
 * Whether granting the system prompt should also switch the in-app preference
 * on. It should, and only in the first-launch case: the reader just answered
 * "Allow" to PersoNewsAP's own request, so leaving the account preference off
 * would silently discard that answer. A later grant from iOS Settings does not
 * come through here and never resurrects an explicit in-app opt-out.
 */
export function shouldEnablePreferenceAfterGrant(input: {
  action: PushPermissionAction;
  grantedStatus: IosPermissionStatus;
}): boolean {
  return input.action === "request_permission" && input.grantedStatus === "granted";
}

/**
 * How Settings should describe the state, so the UI can never claim
 * notifications are working while iOS is refusing them.
 */
export type NotificationSettingsState =
  | "on"
  | "off"
  | "blocked_by_ios"
  | "needs_permission";

export function resolveNotificationSettingsState(input: {
  permissionStatus: IosPermissionStatus;
  notificationsEnabled: boolean;
}): NotificationSettingsState {
  if (!input.notificationsEnabled) {
    return "off";
  }

  if (input.permissionStatus === "denied") {
    // Enabled in the account, refused by the system: say so rather than
    // showing a green "Notifications enabled" that will never fire.
    return "blocked_by_ios";
  }

  if (input.permissionStatus === "undetermined") {
    return "needs_permission";
  }

  return "on";
}
