import * as Notifications from "expo-notifications";

/**
 * How an edition notification behaves while the app is open.
 *
 * Without a handler, expo-notifications shows nothing in the foreground, so a
 * notification arriving while the reader is in the app was silently dropped.
 * PersoNewsAP sends one notification per edition, four times a week, and the
 * reader may well be on another screen when it lands — so it is presented like
 * any other iOS notification: banner and badge.
 *
 * No sound in the foreground: the app is already open and in the reader's
 * hands, so a chime would be noise rather than information. The push itself
 * still carries a sound for the locked/background case, which iOS handles.
 */
export function configureNotificationPresentation(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: true
      })
    });
  } catch {
    // Notification APIs are unavailable in some environments; presentation is
    // never worth blocking app start over.
  }
}
