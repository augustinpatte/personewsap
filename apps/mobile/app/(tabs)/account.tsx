import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { AppScreen } from "../../src/components/AppScreen";
import { AppText } from "../../src/components/AppText";
import { Card } from "../../src/components/Card";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { ProgressPill } from "../../src/components/ProgressPill";
import { SecondaryButton } from "../../src/components/SecondaryButton";
import { tokens } from "../../src/design/tokens";
import { useAuth } from "../../src/features/auth";
import { NotificationPreferencesCard } from "../../src/features/notifications";
import { PreferencesEditor } from "../../src/features/preferences";
import { trackAnalyticsEvent } from "../../src/lib/analytics";
import { formatLanguageName, localized } from "../../src/lib/i18n";
import { type NormalizedSupabaseError } from "../../src/lib/supabase";
import { getUserFacingError } from "../../src/lib/userFacingErrors";

export default function AccountScreen() {
  const router = useRouter();
  const {
    error,
    isConfigured,
    profileCompleted,
    profileLanguage,
    refreshAuthState,
    session,
    signOut,
    status,
    user
  } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [preferencesRefreshKey, setPreferencesRefreshKey] = useState(0);
  const [signOutError, setSignOutError] = useState<NormalizedSupabaseError | null>(null);
  const copy = getAccountCopy(profileLanguage);
  const visibleAccountError = signOutError ?? error;
  const userFacingAccountError = visibleAccountError
    ? getUserFacingError(visibleAccountError, profileLanguage, "account")
    : null;

  useEffect(() => {
    if (visibleAccountError) {
      trackAnalyticsEvent("error_viewed", {
        language: profileLanguage ?? undefined
      });
    }
  }, [profileLanguage, visibleAccountError]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setSignOutError(null);

    try {
      await refreshAuthState();
      setPreferencesRefreshKey((currentKey) => currentKey + 1);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshAuthState]);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    setSignOutError(null);

    const result = await signOut();

    if (result.error) {
      setSignOutError(result.error);
      setIsSigningOut(false);
      return;
    }

    setIsSigningOut(false);
    router.replace("/(auth)/login");
  }, [router, signOut]);

  return (
    <AppScreen>
      <AppScreen.Header>
        <View style={styles.headerTopline}>
          <AppText variant="eyebrow">{copy.eyebrow}</AppText>
          <ProgressPill
            label={session ? copy.signedIn : copy.signedOut}
            tone={session ? "success" : "neutral"}
          />
        </View>
        <View style={styles.headerCopy}>
          <AppText variant="title">{copy.title}</AppText>
          <AppText variant="body">
            {copy.description}
          </AppText>
        </View>
      </AppScreen.Header>

      <AppScreen.Body>
        <Card elevated padding="lg" style={styles.heroCard}>
          <View style={styles.cardTopline}>
            <AppText variant="subtitle">{user?.email ?? copy.noActiveUser}</AppText>
            <ProgressPill
              label={profileCompleted ? copy.ready : onboardingLabel(status, profileLanguage)}
              tone={profileCompleted ? "success" : "warning"}
            />
          </View>
          <AppText color="muted" variant="body">
            {profileCompleted
              ? copy.complete
              : copy.finishOnboarding}
          </AppText>
          <InfoRow
            label={copy.dailyDropLanguage}
            value={formatLanguageName(profileLanguage, profileLanguage)}
          />
        </Card>

        <PreferencesEditor
          onSaved={refreshAuthState}
          refreshKey={preferencesRefreshKey}
          uiLanguage={profileLanguage}
          userId={user?.id ?? null}
        />

        <NotificationPreferencesCard
          language={profileLanguage}
          refreshKey={preferencesRefreshKey}
          userId={user?.id ?? null}
        />

        <Card tone="muted">
          <View style={styles.connectionCard}>
            <AppText variant="subtitle">{copy.connectionTitle}</AppText>
            <AppText color="muted" variant="body">
              {isConfigured ? copy.connectionReady : copy.connectionUnavailable}
            </AppText>
            <ProgressPill
              label={isConfigured ? copy.configured : copy.unavailable}
              tone={isConfigured ? "success" : "warning"}
            />
          </View>
        </Card>

        {userFacingAccountError ? (
          <AppText color="danger" variant="body">
            {userFacingAccountError.message}
          </AppText>
        ) : null}

        <View style={styles.actions}>
          <SecondaryButton disabled={isRefreshing || isSigningOut} label={copy.refresh} onPress={handleRefresh} />
          <PrimaryButton
            disabled={isRefreshing}
            label={copy.logOut}
            loading={isSigningOut}
            onPress={handleSignOut}
            testID="account-logout-button"
          />
        </View>
      </AppScreen.Body>
    </AppScreen>
  );
}

function onboardingLabel(status: string, language: string | null) {
  if (status === "needsOnboarding") {
    return localized({ en: "Needs onboarding", fr: "Onboarding requis" }, language === "fr" ? "fr" : "en");
  }

  if (status === "loading") {
    return localized({ en: "Checking", fr: "Vérification" }, language === "fr" ? "fr" : "en");
  }

  return localized({ en: "Not complete", fr: "Incomplet" }, language === "fr" ? "fr" : "en");
}

function InfoRow({
  label,
  monospace = false,
  selectable = false,
  value
}: {
  label: string;
  monospace?: boolean;
  selectable?: boolean;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <AppText color="muted" style={styles.rowLabel} variant="caption">
        {label}
      </AppText>
      <AppText
        selectable={selectable}
        style={[styles.rowValue, monospace ? styles.monospace : null]}
        variant="bodyStrong"
      >
        {value}
      </AppText>
    </View>
  );
}

function getAccountCopy(language: string | null) {
  const uiLanguage = language === "fr" ? "fr" : "en";

  return localized(
    {
      en: {
        eyebrow: "Account",
        title: "Settings",
        description:
          "Manage your PersoNewsAP account and check that your daily learning setup is ready.",
        signedIn: "Signed in",
        signedOut: "Signed out",
        noActiveUser: "No active user",
        ready: "Ready",
        complete:
          "Your onboarding is complete. Today will show a live assigned drop when one is available.",
        finishOnboarding: "Finish onboarding to unlock your daily drop.",
        dailyDropLanguage: "Daily drop language",
        connectionTitle: "Live account connection",
        connectionReady: "Live account features are available.",
        connectionUnavailable: "Live account features are unavailable right now.",
        unavailable: "Unavailable",
        configured: "Configured",
        refresh: "Refresh",
        logOut: "Log out"
      },
      fr: {
        eyebrow: "Compte",
        title: "Réglages",
        description:
          "Gère ton compte PersoNewsAP et vérifie que ta mise à jour quotidienne est prête.",
        signedIn: "Connecté",
        signedOut: "Déconnecté",
        noActiveUser: "Aucun utilisateur actif",
        ready: "Prêt",
        complete:
          "Ta configuration est terminée. L'écran Aujourd'hui affichera une mise à jour assignée dès qu'elle sera disponible.",
        finishOnboarding: "Termine la configuration pour débloquer ta mise à jour quotidienne.",
        dailyDropLanguage: "Langue de la mise à jour",
        connectionTitle: "Connexion du compte",
        connectionReady: "Les fonctions de compte en direct sont disponibles.",
        connectionUnavailable: "Les fonctions de compte en direct sont indisponibles pour le moment.",
        unavailable: "Indisponible",
        configured: "Configuré",
        refresh: "Actualiser",
        logOut: "Se déconnecter"
      }
    },
    uiLanguage
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: tokens.space.md
  },
  headerTopline: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  headerCopy: {
    gap: tokens.space.sm
  },
  heroCard: {
    gap: tokens.space.lg
  },
  cardTopline: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  connectionCard: {
    gap: tokens.space.sm
  },
  monospace: {
    fontFamily: "Courier",
    fontSize: 13,
    lineHeight: 19
  },
  row: {
    gap: tokens.space.xs
  },
  rowLabel: {
    textTransform: "uppercase"
  },
  rowValue: {
    flexShrink: 1
  }
});
