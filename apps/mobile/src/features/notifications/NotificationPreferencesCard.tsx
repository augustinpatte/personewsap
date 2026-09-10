import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Linking, StyleSheet, Switch, View } from "react-native";

import { AppText, Card, ProgressPill } from "../../components";
import { SecondaryButton } from "../../components/SecondaryButton";
import { tokens } from "../../design/tokens";
import { useThemeColors } from "../../design/theme";
import { formatLanguageName, localized } from "../../lib/i18n";
import { getUserFacingErrorMessage } from "../../lib/userFacingErrors";
import type { Language } from "../../types/domain";
import {
  readIosPermissionStatus,
  loadNotificationPreferences,
  saveNotificationPreferences,
  type NotificationPreferences,
  type NotificationRegistrationState
} from "./pushNotificationPreferences";
import { decideNotificationSettingsAction, type IosPermissionStatus } from "./pushPermissionFlow";

type NotificationPreferencesCardProps = {
  language?: Language | null;
  refreshKey: number;
  userId: string | null;
};

export function NotificationPreferencesCard({
  language,
  refreshKey,
  userId
}: NotificationPreferencesCardProps) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<IosPermissionStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [registrationState, setRegistrationState] =
    useState<NotificationRegistrationState>("not_requested");
  const colors = useThemeColors();
  const uiLanguage = preferences?.language ?? language ?? "en";
  const copy = getNotificationCopy(uiLanguage);

  const loadPreferences = useCallback(async () => {
    if (!userId) {
      setPreferences(null);
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    const result = await loadNotificationPreferences(userId, language ?? null);

    setLoading(false);

    if (!result.ok) {
      setErrorMessage(getUserFacingErrorMessage(result.error, language, "notification"));
      return;
    }

    setPreferences(result.preferences);

    // A stored device row is not proof that notifications work: the reader may
    // have revoked permission in iOS Settings since it was written. Ask the
    // system, so this card can never promise a notification iOS will refuse to
    // deliver.
    const systemStatus = await readIosPermissionStatus();

    setPermissionStatus(systemStatus);
    setRegistrationState(
      systemStatus === "denied"
        ? "denied"
        : result.preferences.tokenStored && systemStatus === "granted"
          ? "granted"
          : "not_requested"
    );
  }, [language, userId]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences, refreshKey]);

  // Back from iOS Settings: the reader may have just switched notifications on
  // there, and the card must say so without being reopened.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void loadPreferences();
      }
    });

    return () => subscription.remove();
  }, [loadPreferences]);

  const savePreferences = useCallback(
    async (nextEnabled: boolean) => {
      if (!userId) {
        return;
      }

      setSaving(true);
      setStatusMessage(null);
      setErrorMessage(null);

      const result = await saveNotificationPreferences({
        enabled: nextEnabled,
        language: uiLanguage,
        userId
      });

      setSaving(false);

      if (!result.ok) {
        setRegistrationState(result.registrationState);
        setPreferences((current) =>
          current
            ? {
                ...current,
                notificationsEnabled: false,
                tokenStored: false
              }
            : current
        );
        // A refusal is explained by the section itself, with the way out; an
        // error line underneath would say the same thing twice.
        if (result.registrationState !== "denied") {
          setErrorMessage(getUserFacingErrorMessage(result.error, uiLanguage, "notification"));
        }
        await loadPreferences();
        return;
      }

      setRegistrationState(result.registrationState);
      setPreferences((current) =>
        current
          ? {
              ...current,
              notificationsEnabled: nextEnabled,
              tokenStored: nextEnabled && result.registrationState === "granted"
            }
          : current
      );
      setStatusMessage(result.warning ?? statusMessageFor(nextEnabled, result.registrationState, uiLanguage));
      await loadPreferences();
    },
    [loadPreferences, uiLanguage, userId]
  );

  if (!userId) {
    return (
      <Card tone="muted">
        <AppText variant="subtitle">{copy.title}</AppText>
        <AppText color="muted" variant="body">
          {copy.signIn}
        </AppText>
      </Card>
    );
  }

  if (loading && !preferences) {
    return (
      <Card tone="muted" style={styles.loadingCard}>
        <ActivityIndicator color={colors.accent} />
        <AppText color="muted" variant="body">
          {copy.loading}
        </AppText>
      </Card>
    );
  }

  const enabled = preferences?.notificationsEnabled ?? false;
  const action =
    preferences && permissionStatus
      ? decideNotificationSettingsAction({
          permissionStatus,
          notificationsEnabled: enabled,
          hasActiveDevice: preferences.tokenStored
        })
      : "none";
  // Refused at system level: the switch cannot change that, and pretending it
  // could would be a control that silently does nothing.
  const blockedBySystem = action === "open_system_settings";

  return (
    <Card tone="muted">
      <View style={styles.topline}>
        <View style={styles.copy}>
          <AppText variant="subtitle">{copy.title}</AppText>
          <AppText color="muted" variant="body">
            {copy.description}
          </AppText>
        </View>
        <Switch
          accessibilityLabel={copy.title}
          disabled={saving || loading || !preferences?.tokenStorageReady || blockedBySystem}
          ios_backgroundColor={colors.borderStrong}
          onValueChange={(nextValue) => {
            void savePreferences(nextValue);
          }}
          thumbColor={colors.white}
          trackColor={{
            false: colors.borderStrong,
            true: colors.accent
          }}
          value={enabled && !blockedBySystem}
        />
      </View>

      {blockedBySystem ? (
        <View style={styles.systemBlock}>
          <AppText variant="bodyStrong">{copy.systemOffTitle}</AppText>
          <AppText color="muted" variant="body">
            {copy.systemOffBody}
          </AppText>
          <SecondaryButton
            label={copy.openSettings}
            onPress={() => {
              void Linking.openSettings();
            }}
          />
        </View>
      ) : action === "request_permission" && !enabled ? (
        <AppText color="muted" variant="caption">
          {copy.permissionHint}
        </AppText>
      ) : null}

      <View style={styles.metaRows}>
        <InfoRow label={copy.language} value={formatLanguageName(preferences?.language ?? null, uiLanguage)} />
        <InfoRow
          label={copy.pushToken}
          value={
            preferences?.tokenStorageReady
              ? preferences.tokenStored
                ? copy.tokenStored
                : copy.tokenNotStored
              : copy.tableNotReady
          }
        />
      </View>

      <ProgressPill
        label={registrationLabel(blockedBySystem ? "denied" : registrationState, enabled, uiLanguage)}
        tone={enabled && !blockedBySystem ? "success" : "neutral"}
      />

      {saving ? (
        <AppText color="muted" variant="caption">
          {copy.saving}
        </AppText>
      ) : null}
      {errorMessage ? <AppText color="danger" variant="body">{errorMessage}</AppText> : null}
      {statusMessage && !blockedBySystem ? (
        <AppText color="accent" variant="bodyStrong">{statusMessage}</AppText>
      ) : null}
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText color="muted" style={styles.rowLabel} variant="caption">
        {label}
      </AppText>
      <AppText style={styles.rowValue} variant="bodyStrong">
        {value}
      </AppText>
    </View>
  );
}

function registrationLabel(
  state: NotificationRegistrationState,
  enabled: boolean,
  language: Language
) {
  const copy = getNotificationCopy(language);

  if (state === "denied") {
    return copy.denied;
  }

  if (enabled && state === "granted") {
    return copy.ready;
  }

  if (state === "missing_project_id") {
    return copy.needsEas;
  }

  if (state === "simulator_unsupported") {
    return copy.deviceOnly;
  }

  if (state === "storage_not_ready") {
    return copy.storageNeeded;
  }

  return enabled ? copy.checking : copy.off;
}

function statusMessageFor(
  enabled: boolean,
  state: NotificationRegistrationState,
  language: Language
) {
  const copy = getNotificationCopy(language);

  if (!enabled) {
    return copy.disabled;
  }

  if (state === "granted") {
    return copy.enabled;
  }

  return copy.saved;
}

function getNotificationCopy(language: Language) {
  return localized(
    {
      en: {
        title: "Edition notifications",
        description:
          "Your edition at 19:00 your time, and one reminder the next morning only if your session is unfinished.",
        signIn: "Sign in to manage edition notifications.",
        loading: "Loading notification settings...",
        language: "Language",
        pushToken: "This account",
        tokenStored: "Ready to receive notifications",
        tokenNotStored: "Not enabled",
        tableNotReady: "Unavailable",
        saving: "Saving notification settings...",
        ready: "On",
        denied: "Off in your phone's Settings",
        needsEas: "Unavailable",
        deviceOnly: "Phone only",
        storageNeeded: "Unavailable",
        checking: "Checking",
        off: "Off",
        disabled: "Edition notifications turned off.",
        enabled: "You will be notified at 19:00 your time when each new edition is ready.",
        saved: "Notification settings saved.",
        systemOffTitle: "Notifications are off for PersoNews on this phone",
        systemOffBody:
          "They were turned off at system level, so only your phone's Settings can turn them back on. PersoNews will not ask again.",
        openSettings: "Open Settings",
        permissionHint: "Switching this on will ask your phone for permission, once."
      },
      fr: {
        title: "Notifications d'édition",
        description:
          "Votre édition à 19 h, heure locale, et un seul rappel le lendemain matin si votre session n'est pas terminée.",
        signIn: "Connectez-vous pour gérer les notifications d'édition.",
        loading: "Chargement des réglages de notification...",
        language: "Langue",
        pushToken: "Ce compte",
        tokenStored: "Prêt à recevoir les notifications",
        tokenNotStored: "Non activé",
        tableNotReady: "Indisponible",
        saving: "Enregistrement des réglages de notification...",
        ready: "Activées",
        denied: "Désactivées dans les Réglages du téléphone",
        needsEas: "Indisponible",
        deviceOnly: "Téléphone requis",
        storageNeeded: "Indisponible",
        checking: "Vérification",
        off: "Désactivées",
        disabled: "Notifications d'édition désactivées.",
        enabled: "Vous serez notifié à 19 h, heure locale, à chaque nouvelle édition.",
        saved: "Réglages de notification enregistrés.",
        systemOffTitle: "Les notifications de PersoNews sont désactivées sur ce téléphone",
        systemOffBody:
          "Elles ont été coupées au niveau du système : seuls les Réglages du téléphone peuvent les réactiver. PersoNews ne vous le redemandera pas.",
        openSettings: "Ouvrir les Réglages",
        permissionHint: "L'activer demandera une seule fois l'autorisation à votre téléphone."
      }
    },
    language
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    gap: tokens.space.xs
  },
  loadingCard: {
    alignItems: "center",
    paddingVertical: tokens.space.xl
  },
  metaRows: {
    gap: tokens.space.sm
  },
  row: {
    gap: tokens.space.xs
  },
  rowLabel: {
    textTransform: "uppercase"
  },
  rowValue: {
    flexShrink: 1
  },
  systemBlock: {
    gap: tokens.space.sm
  },
  topline: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  }
});
