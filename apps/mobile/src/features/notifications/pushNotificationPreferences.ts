import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { localized } from "../../lib/i18n";
import { normalizeSupabaseError, supabase, type NormalizedSupabaseError } from "../../lib/supabase";
import type { Language } from "../../types/domain";

export type NotificationPreferences = {
  language: Language | null;
  notificationsEnabled: boolean;
  preferredNotificationTime: string;
  timezone: string | null;
  tokenStorageReady: boolean;
  tokenStored: boolean;
};

export type NotificationRegistrationState =
  | "not_requested"
  | "granted"
  | "denied"
  | "simulator_unsupported"
  | "missing_project_id"
  | "registration_failed"
  | "storage_not_ready";

type LoadNotificationPreferencesResult =
  | { ok: true; preferences: NotificationPreferences }
  | { ok: false; error: NormalizedSupabaseError };

type SaveNotificationPreferencesResult =
  | { ok: true; registrationState: NotificationRegistrationState; warning?: string }
  | { ok: false; error: NormalizedSupabaseError; registrationState: NotificationRegistrationState };

type RegisterPushTokenResult =
  | { ok: true; token: string; registrationState: "granted" }
  | { ok: false; error: NormalizedSupabaseError; registrationState: Exclude<NotificationRegistrationState, "granted"> };

const DEFAULT_NOTIFICATION_TIME = "08:00";

function getNotificationPreferenceCopy(language: Language | null | undefined) {
  return localized(
    {
      en: {
        missingConfig: "Live notification preferences are not configured for this build.",
        loadFailed: "Could not load notification preferences.",
        invalidTime: "Choose a reminder time in HH:MM format.",
        cleanupWarning:
          "Reminder disabled. Some old reminder data may clear later.",
        platformUnsupported: "Push reminders are available on iOS and Android builds.",
        deviceRequired: "Expo push tokens require a physical iOS or Android device.",
        missingProjectId: "Push reminders are not available in this build yet.",
        denied: "Notifications are off. You can keep using PersoNewsAP without reminders.",
        registerFailed: "Could not register this device for push reminders.",
        saveFailed: "Could not save notification preferences.",
        tokenStoreFailed: "Could not store this device for push reminders.",
        tokenCleanupFailed: "Could not disable stored push reminders."
      },
      fr: {
        missingConfig:
          "Les préférences de notification live ne sont pas configurées pour cette version.",
        loadFailed: "Impossible de charger les préférences de notification.",
        invalidTime: "Choisis une heure de rappel au format HH:MM.",
        cleanupWarning:
          "Rappel désactivé. Certaines anciennes données de rappel pourront être effacées plus tard.",
        platformUnsupported:
          "Les rappels push sont disponibles sur les builds iOS et Android.",
        deviceRequired:
          "Les jetons push Expo nécessitent un appareil iOS ou Android physique.",
        missingProjectId:
          "Les rappels push ne sont pas encore disponibles dans cette version.",
        denied:
          "Les notifications sont désactivées. Tu peux continuer à utiliser PersoNewsAP sans rappel.",
        registerFailed: "Impossible d'inscrire cet appareil aux rappels push.",
        saveFailed: "Impossible d'enregistrer les préférences de notification.",
        tokenStoreFailed: "Impossible d'enregistrer cet appareil pour les rappels push.",
        tokenCleanupFailed: "Impossible de désactiver les rappels push enregistrés."
      }
    },
    language
  );
}

export async function loadNotificationPreferences(
  userId: string,
  language: Language | null = null
): Promise<LoadNotificationPreferencesResult> {
  const copy = getNotificationPreferenceCopy(language);

  if (!supabase) {
    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: copy.missingConfig
      }
    };
  }

  try {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("language, timezone")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      return { ok: false, error: normalizeSupabaseError(profileError, copy.loadFailed) };
    }

    const { data: userPreferences, error: preferencesError } = await supabase
      .from("user_preferences")
      .select("notifications_enabled, preferred_notification_time")
      .eq("user_id", userId)
      .maybeSingle();

    if (preferencesError) {
      return { ok: false, error: normalizeSupabaseError(preferencesError, copy.loadFailed) };
    }

    const { data: tokens, error: tokensError } = await supabase
      .from("push_tokens")
      .select("id")
      .eq("user_id", userId)
      .eq("enabled", true)
      .limit(1);

    const tokenStorageReady = !isMissingTableError(tokensError);

    if (tokensError && tokenStorageReady) {
      return { ok: false, error: normalizeSupabaseError(tokensError, copy.loadFailed) };
    }

    return {
      ok: true,
      preferences: {
        language: profile?.language ?? null,
        notificationsEnabled: userPreferences?.notifications_enabled ?? false,
        preferredNotificationTime:
          userPreferences?.preferred_notification_time ?? DEFAULT_NOTIFICATION_TIME,
        timezone: profile?.timezone ?? null,
        tokenStorageReady,
        tokenStored: tokenStorageReady && (tokens?.length ?? 0) > 0
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeSupabaseError(error, copy.loadFailed)
    };
  }
}

export async function saveNotificationPreferences({
  enabled,
  language = null,
  preferredNotificationTime,
  userId
}: {
  enabled: boolean;
  language?: Language | null;
  preferredNotificationTime: string;
  userId: string;
}): Promise<SaveNotificationPreferencesResult> {
  const copy = getNotificationPreferenceCopy(language);

  if (!supabase) {
    return {
      ok: false,
      registrationState: "storage_not_ready",
      error: {
        code: "missing_supabase_config",
        message: copy.missingConfig
      }
    };
  }

  const notificationTime = normalizeNotificationTime(preferredNotificationTime);

  if (!notificationTime) {
    return {
      ok: false,
      registrationState: "not_requested",
      error: {
        code: "invalid_notification_time",
        message: copy.invalidTime
      }
    };
  }

  if (!enabled) {
    const preferencesResult = await upsertNotificationPreferences(userId, false, notificationTime, language);

    if (!preferencesResult.ok) {
      return {
        ok: false,
        registrationState: "not_requested",
        error: preferencesResult.error
      };
    }

    const disableResult = await disableStoredPushTokens(userId, language);

    return {
      ok: true,
      registrationState: disableResult.ok ? "not_requested" : "storage_not_ready",
      warning: disableResult.ok ? undefined : copy.cleanupWarning
    };
  }

  const registration = await registerForPushNotifications(language);

  if (!registration.ok) {
    await upsertNotificationPreferences(userId, false, notificationTime, language);

    return {
      ok: false,
      registrationState: registration.registrationState,
      error: registration.error
    };
  }

  const tokenResult = await storePushToken(userId, registration.token, language);

  if (!tokenResult.ok) {
    await upsertNotificationPreferences(userId, false, notificationTime, language);

    return {
      ok: false,
      registrationState: "storage_not_ready",
      error: tokenResult.error
    };
  }

  const preferencesResult = await upsertNotificationPreferences(userId, true, notificationTime, language);

  if (!preferencesResult.ok) {
    return {
      ok: false,
      registrationState: "storage_not_ready",
      error: preferencesResult.error
    };
  }

  return { ok: true, registrationState: "granted" };
}

export function normalizeNotificationTime(value: string): string | null {
  const trimmed = value.trim();

  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

async function registerForPushNotifications(
  language: Language | null
): Promise<RegisterPushTokenResult> {
  const copy = getNotificationPreferenceCopy(language);

  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return {
      ok: false,
      registrationState: "simulator_unsupported",
      error: {
        code: "push_platform_unsupported",
        message: copy.platformUnsupported
      }
    };
  }

  if (!Device.isDevice) {
    return {
      ok: false,
      registrationState: "simulator_unsupported",
      error: {
        code: "push_requires_device",
        message: copy.deviceRequired
      }
    };
  }

  const projectId = getExpoProjectId();

  if (!projectId) {
    return {
      ok: false,
      registrationState: "missing_project_id",
      error: {
        code: "missing_eas_project_id",
        message: copy.missingProjectId
      }
    };
  }

  const existingPermission = await Notifications.getPermissionsAsync();
  let finalStatus = existingPermission.status;

  if (finalStatus !== "granted") {
    const requestedPermission = await Notifications.requestPermissionsAsync();
    finalStatus = requestedPermission.status;
  }

  if (finalStatus !== "granted") {
    return {
      ok: false,
      registrationState: "denied",
      error: {
        code: "notifications_denied",
        message: copy.denied
      }
    };
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });

    return {
      ok: true,
      registrationState: "granted",
      token: token.data
    };
  } catch (error) {
    return {
      ok: false,
      registrationState: "registration_failed",
      error: normalizeSupabaseError(error, copy.registerFailed)
    };
  }
}

async function storePushToken(
  userId: string,
  expoPushToken: string,
  language: Language | null
): Promise<{ ok: true } | { ok: false; error: NormalizedSupabaseError }> {
  const copy = getNotificationPreferenceCopy(language);

  if (!supabase) {
    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: copy.missingConfig
      }
    };
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("push_tokens").upsert(
    {
      user_id: userId,
      expo_push_token: expoPushToken,
      platform: normalizePlatform(Platform.OS),
      enabled: true,
      last_registered_at: now,
      updated_at: now
    },
    { onConflict: "user_id,expo_push_token" }
  );

  if (error) {
    return { ok: false, error: normalizeSupabaseError(error, copy.tokenStoreFailed) };
  }

  return { ok: true };
}

async function disableStoredPushTokens(
  userId: string,
  language: Language | null
): Promise<{ ok: true } | { ok: false; error: NormalizedSupabaseError }> {
  const copy = getNotificationPreferenceCopy(language);

  if (!supabase) {
    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: copy.missingConfig
      }
    };
  }

  const { error } = await supabase
    .from("push_tokens")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error) {
    return { ok: false, error: normalizeSupabaseError(error, copy.tokenCleanupFailed) };
  }

  return { ok: true };
}

async function upsertNotificationPreferences(
  userId: string,
  notificationsEnabled: boolean,
  preferredNotificationTime: string,
  language: Language | null
): Promise<{ ok: true } | { ok: false; error: NormalizedSupabaseError }> {
  const copy = getNotificationPreferenceCopy(language);

  if (!supabase) {
    return {
      ok: false,
      error: {
        code: "missing_supabase_config",
        message: copy.missingConfig
      }
    };
  }

  const { error } = await supabase.from("user_preferences").upsert({
    user_id: userId,
    notifications_enabled: notificationsEnabled,
    preferred_notification_time: preferredNotificationTime,
    updated_at: new Date().toISOString()
  });

  if (error) {
    return { ok: false, error: normalizeSupabaseError(error, copy.saveFailed) };
  }

  return { ok: true };
}

function getExpoProjectId(): string | null {
  const envProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();

  if (envProjectId) {
    return envProjectId;
  }

  const easConfig = Constants.easConfig as { projectId?: string } | null;

  if (easConfig?.projectId) {
    return easConfig.projectId;
  }

  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;

  return extra?.eas?.projectId ?? null;
}

function normalizePlatform(platform: string): "ios" | "android" | "web" | "unknown" {
  if (platform === "ios" || platform === "android" || platform === "web") {
    return platform;
  }

  return "unknown";
}

function isMissingTableError(error: unknown): boolean {
  const normalized = normalizeSupabaseError(error);

  return (
    normalized.code === "42P01" ||
    normalized.code === "PGRST205" ||
    normalized.message.toLowerCase().includes("push_tokens")
  );
}
