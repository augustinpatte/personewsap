import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from "react-native";

import { AppText, Card, ProgressPill } from "../../components";
import { tokens } from "../../design/tokens";
import { formatLanguageName, localized } from "../../lib/i18n";
import { getUserFacingErrorMessage } from "../../lib/userFacingErrors";
import type { Language } from "../../types/domain";
import {
  loadNotificationPreferences,
  normalizeNotificationTime,
  saveNotificationPreferences,
  type NotificationPreferences,
  type NotificationRegistrationState
} from "./pushNotificationPreferences";

type NotificationPreferencesCardProps = {
  language?: Language | null;
  refreshKey: number;
  userId: string | null;
};

const TIME_OPTIONS = ["07:30", "08:00", "12:00", "18:00"];

export function NotificationPreferencesCard({
  language,
  refreshKey,
  userId
}: NotificationPreferencesCardProps) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [registrationState, setRegistrationState] =
    useState<NotificationRegistrationState>("not_requested");
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
    setRegistrationState(result.preferences.tokenStored ? "granted" : "not_requested");
  }, [language, userId]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences, refreshKey]);

  const savePreferences = useCallback(
    async (nextEnabled: boolean, nextTime: string) => {
      if (!userId) {
        return;
      }

      const normalizedTime = normalizeNotificationTime(nextTime);

      if (!normalizedTime) {
        setErrorMessage(copy.invalidTime);
        return;
      }

      setSaving(true);
      setStatusMessage(null);
      setErrorMessage(null);

      const result = await saveNotificationPreferences({
        enabled: nextEnabled,
        language: uiLanguage,
        preferredNotificationTime: normalizedTime,
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
                preferredNotificationTime: normalizedTime,
                tokenStored: false
              }
            : current
        );
        setErrorMessage(getUserFacingErrorMessage(result.error, uiLanguage, "notification"));
        return;
      }

      setRegistrationState(result.registrationState);
      setPreferences((current) =>
        current
          ? {
              ...current,
              notificationsEnabled: nextEnabled,
              preferredNotificationTime: normalizedTime,
              tokenStored: nextEnabled && result.registrationState === "granted"
            }
          : current
      );
      setStatusMessage(result.warning ?? statusMessageFor(nextEnabled, result.registrationState, uiLanguage));
      await loadPreferences();
    },
    [copy.invalidTime, loadPreferences, uiLanguage, userId]
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
        <ActivityIndicator color={tokens.color.accent} />
        <AppText color="muted" variant="body">
          {copy.loading}
        </AppText>
      </Card>
    );
  }

  const enabled = preferences?.notificationsEnabled ?? false;
  const preferredTime = preferences?.preferredNotificationTime ?? "08:00";

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
          disabled={saving || loading || !preferences?.tokenStorageReady}
          ios_backgroundColor={tokens.color.borderStrong}
          onValueChange={(nextValue) => {
            void savePreferences(nextValue, preferredTime);
          }}
          thumbColor={tokens.color.white}
          trackColor={{
            false: tokens.color.borderStrong,
            true: tokens.color.accent
          }}
          value={enabled}
        />
      </View>

      <View style={styles.metaRows}>
        <InfoRow label={copy.language} value={formatLanguageName(preferences?.language ?? null, uiLanguage)} />
        <InfoRow label={copy.timezone} value={preferences?.timezone ?? copy.notSet} />
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

      <View style={styles.group}>
        <AppText color="muted" style={styles.groupTitle} variant="caption">
          {copy.preferredTime}
        </AppText>
        <View style={styles.timeGrid}>
          {TIME_OPTIONS.map((time) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: preferredTime === time }}
              disabled={saving || loading}
              key={time}
              onPress={() => {
                void savePreferences(enabled, time);
              }}
              style={[
                styles.timeButton,
                preferredTime === time ? styles.timeButtonSelected : null
              ]}
            >
              <AppText
                color={preferredTime === time ? "accentInk" : "inkSoft"}
                variant="bodyStrong"
              >
                {time}
              </AppText>
            </Pressable>
          ))}
        </View>
      </View>

      <ProgressPill label={registrationLabel(registrationState, enabled, uiLanguage)} tone={enabled ? "success" : "neutral"} />

      {saving ? (
        <AppText color="muted" variant="caption">
          {copy.saving}
        </AppText>
      ) : null}
      {errorMessage ? <AppText color="danger" variant="body">{errorMessage}</AppText> : null}
      {statusMessage ? <AppText color="accent" variant="bodyStrong">{statusMessage}</AppText> : null}
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

  if (enabled && state === "granted") {
    return copy.ready;
  }

  if (state === "denied") {
    return copy.denied;
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
        title: "Daily reminder",
        description: "Optional push reminder after account setup.",
        signIn: "Sign in to manage push reminder preferences.",
        loading: "Loading reminder settings...",
        invalidTime: "Choose a reminder time in HH:MM format.",
        language: "Language",
        timezone: "Timezone",
        notSet: "Not set",
        pushToken: "Reminder status",
        tokenStored: "Ready for this account",
        tokenNotStored: "Not enabled",
        tableNotReady: "Unavailable",
        preferredTime: "Preferred time",
        saving: "Saving reminder settings...",
        ready: "Ready",
        denied: "Denied",
        needsEas: "Setup needed",
        deviceOnly: "Device only",
        storageNeeded: "Storage needed",
        checking: "Checking",
        off: "Off",
        disabled: "Daily reminder disabled.",
        enabled: "Daily reminder enabled for future drops.",
        saved: "Reminder settings saved."
      },
      fr: {
        title: "Rappel quotidien",
        description: "Notification optionnelle après la configuration du compte.",
        signIn: "Connecte-toi pour gérer les notifications de rappel.",
        loading: "Chargement des réglages de rappel...",
        invalidTime: "Choisis une heure de rappel au format HH:MM.",
        language: "Langue",
        timezone: "Fuseau horaire",
        notSet: "Non défini",
        pushToken: "État du rappel",
        tokenStored: "Prêt pour ce compte",
        tokenNotStored: "Non activé",
        tableNotReady: "Indisponible",
        preferredTime: "Heure préférée",
        saving: "Enregistrement des réglages de rappel...",
        ready: "Prêt",
        denied: "Refusé",
        needsEas: "Configuration requise",
        deviceOnly: "Appareil requis",
        storageNeeded: "Stockage requis",
        checking: "Vérification",
        off: "Désactivé",
        disabled: "Rappel quotidien désactivé.",
        enabled: "Rappel quotidien activé pour les prochaines mises à jour.",
        saved: "Réglages de rappel enregistrés."
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
  group: {
    gap: tokens.space.sm
  },
  groupTitle: {
    textTransform: "uppercase"
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
  timeButton: {
    alignItems: "center",
    backgroundColor: tokens.color.backgroundRaised,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm
  },
  timeButtonSelected: {
    backgroundColor: tokens.color.accentSoft,
    borderColor: tokens.color.accent
  },
  timeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm
  },
  topline: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  }
});
