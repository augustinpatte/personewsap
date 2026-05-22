import { useCallback, useEffect, useState } from "react";
import { Modal, Share, StyleSheet, View } from "react-native";
import { useRouter, type Href } from "expo-router";

import { AppScreen } from "../../src/components/AppScreen";
import { AppText } from "../../src/components/AppText";
import { Card } from "../../src/components/Card";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { ProgressPill } from "../../src/components/ProgressPill";
import { SecondaryButton } from "../../src/components/SecondaryButton";
import { tokens } from "../../src/design/tokens";
import {
  exportAuthenticatedUserData,
  requestAuthenticatedAccountDeletion
} from "../../src/features/account/privacyData";
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
  const [isExportingData, setIsExportingData] = useState(false);
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false);
  const [preferencesRefreshKey, setPreferencesRefreshKey] = useState(0);
  const [privacyActionError, setPrivacyActionError] = useState<NormalizedSupabaseError | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteRequestMessage, setDeleteRequestMessage] = useState<string | null>(null);
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

  const handleExportData = useCallback(async () => {
    if (!user?.id) {
      setPrivacyActionError({ code: "missing_user", message: copy.noActiveUser });
      return;
    }

    setIsExportingData(true);
    setPrivacyActionError(null);
    setExportMessage(null);

    const result = await exportAuthenticatedUserData(user.id);

    setIsExportingData(false);

    if (result.error || !result.data) {
      setPrivacyActionError(result.error);
      return;
    }

    try {
      await Share.share({
        message: result.data,
        title: copy.exportShareTitle
      });
      setExportMessage(copy.exportShared);
    } catch {
      setPrivacyActionError({
        code: "data_export_share_failed",
        message: copy.exportShareFailed
      });
    }
  }, [copy.exportShareFailed, copy.exportShareTitle, copy.exportShared, copy.noActiveUser, user?.id]);

  const handleRequestDeletion = useCallback(async () => {
    if (!user?.id) {
      setPrivacyActionError({ code: "missing_user", message: copy.noActiveUser });
      return;
    }

    setIsRequestingDeletion(true);
    setPrivacyActionError(null);
    setDeleteRequestMessage(null);

    const result = await requestAuthenticatedAccountDeletion(user.id);

    setIsRequestingDeletion(false);

    if (result.error) {
      setPrivacyActionError(result.error);
      return;
    }

    setDeleteModalVisible(false);
    setDeleteRequestMessage(copy.deletionRequested);
  }, [copy.deletionRequested, copy.noActiveUser, user?.id]);

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

        <Card tone="muted">
          <View style={styles.connectionCard}>
            <AppText variant="subtitle">{copy.privacyTitle}</AppText>
            <AppText color="muted" variant="body">
              {copy.privacyDescription}
            </AppText>
            <View style={styles.linkActions}>
              <SecondaryButton
                label={copy.privacyPolicy}
                onPress={() => router.push("/privacy" as Href)}
              />
              <SecondaryButton
                disabled={isExportingData}
                label={copy.exportData}
                onPress={handleExportData}
              />
              <SecondaryButton
                label={copy.deleteAccount}
                onPress={() => setDeleteModalVisible(true)}
              />
            </View>
            {deleteRequestMessage ? (
              <AppText color="success" variant="body">
                {deleteRequestMessage}
              </AppText>
            ) : null}
            {exportMessage ? (
              <AppText color="success" variant="body">
                {exportMessage}
              </AppText>
            ) : null}
            {privacyActionError ? (
              <AppText color="danger" variant="body">
                {privacyActionError.message}
              </AppText>
            ) : null}
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
            disabled={isRefreshing || isSigningOut}
            label={copy.logOut}
            loading={isSigningOut}
            onPress={handleSignOut}
            testID="account-logout-button"
          />
        </View>
      </AppScreen.Body>

      <Modal
        animationType="fade"
        onRequestClose={() => setDeleteModalVisible(false)}
        transparent
        visible={deleteModalVisible}
      >
        <View style={styles.modalOverlay}>
          <Card elevated padding="lg" style={styles.deleteModal}>
            <AppText variant="subtitle">{copy.deleteConfirmTitle}</AppText>
            <AppText color="muted" variant="body">
              {copy.deleteConfirmDescription}
            </AppText>
            <View style={styles.actions}>
              <SecondaryButton
                disabled={isRequestingDeletion}
                label={copy.cancel}
                onPress={() => setDeleteModalVisible(false)}
              />
              <PrimaryButton
                disabled={isRequestingDeletion}
                label={copy.confirmDeletion}
                loading={isRequestingDeletion}
                onPress={handleRequestDeletion}
              />
            </View>
          </Card>
        </View>
      </Modal>
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
          "Your setup is complete. Today will show your assigned drop when one is available.",
        finishOnboarding: "Finish onboarding to unlock your daily drop.",
        dailyDropLanguage: "Daily drop language",
        connectionTitle: "Account connection",
        connectionReady: "Your account features are available.",
        connectionUnavailable: "Account features are unavailable right now.",
        unavailable: "Unavailable",
        configured: "Ready",
        refresh: "Refresh",
        logOut: "Log out",
        privacyTitle: "Privacy and data",
        privacyDescription:
          "Review privacy information, request a data export, or ask for account deletion.",
        privacyPolicy: "Privacy policy",
        exportData: "Export data",
        deleteAccount: "Delete account",
        exportShareTitle: "PersoNewsAP data export",
        exportShared: "Data export opened.",
        exportShareFailed: "The data export could not be opened on this device.",
        deleteConfirmTitle: "Request account deletion?",
        deleteConfirmDescription:
          "This is permanent once processed. Your account, preferences, interactions, mini-case responses, push tokens, and assigned daily drop links may be removed by the secure backend deletion process.",
        deletionRequested: "Deletion request submitted.",
        cancel: "Cancel",
        close: "Close",
        confirmDeletion: "Request deletion"
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
        connectionReady: "Les fonctions de ton compte sont disponibles.",
        connectionUnavailable: "Les fonctions de compte sont indisponibles pour le moment.",
        unavailable: "Indisponible",
        configured: "Prêt",
        refresh: "Actualiser",
        logOut: "Se déconnecter",
        privacyTitle: "Confidentialité et données",
        privacyDescription:
          "Consulte les informations de confidentialité, demande un export de données ou une suppression de compte.",
        privacyPolicy: "Politique de confidentialité",
        exportData: "Exporter les données",
        deleteAccount: "Supprimer le compte",
        exportShareTitle: "Export de données PersoNewsAP",
        exportShared: "Export de données ouvert.",
        exportShareFailed: "L'export de données ne peut pas être ouvert sur cet appareil.",
        deleteConfirmTitle: "Demander la suppression du compte ?",
        deleteConfirmDescription:
          "Cette action est permanente une fois traitée. Ton compte, tes préférences, interactions, réponses aux mini-cas, jetons push et liens de mises à jour assignées peuvent être supprimés par le processus sécurisé côté serveur.",
        deletionRequested: "Demande de suppression envoyée.",
        cancel: "Annuler",
        close: "Fermer",
        confirmDeletion: "Demander la suppression"
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
  deleteModal: {
    gap: tokens.space.lg,
    maxWidth: 420,
    width: "100%"
  },
  linkActions: {
    gap: tokens.space.sm
  },
  modalOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(17, 24, 39, 0.44)",
    flex: 1,
    justifyContent: "center",
    padding: tokens.space.lg
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
