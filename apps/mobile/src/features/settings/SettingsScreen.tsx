import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Share, StyleSheet, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect, useRouter, type Href } from "expo-router";

import { AppScreen } from "../../components/AppScreen";
import { AppText } from "../../components/AppText";
import { Card } from "../../components/Card";
import { IconBadge, type IconBadgeName } from "../../components/IconBadge";
import { PrimaryButton } from "../../components/PrimaryButton";
import { SecondaryButton } from "../../components/SecondaryButton";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import {
  exportAuthenticatedUserData,
  requestAuthenticatedAccountDeletion
} from "../account/privacyData";
import { useAuth } from "../auth";
import { NotificationPreferencesCard } from "../notifications";
import { LearningAccountSection } from "../learning";
import { PreferencesEditor, updateProfileLanguage } from "../preferences";
import { recordLanguageChangeNotice } from "../preferences/languageChangeNotice";
import { shouldApplyLanguageSaveResult } from "../preferences/languagePersistence";
import { LANGUAGE_OPTIONS, localizeOptions, SelectableCard } from "../onboarding";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { formatLanguageName, localized } from "../../lib/i18n";
import { type NormalizedSupabaseError } from "../../lib/supabase";
import type { Language } from "../../types/domain";
import { getUserFacingError } from "../../lib/userFacingErrors";

export function SettingsScreen() {
  const router = useRouter();
  const {
    applyProfileLanguage,
    error,
    profileCompleted,
    profileLanguage,
    refreshAuthState,
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
  const [languageSaveError, setLanguageSaveError] = useState<string | null>(null);
  const languageSaveRequestRef = useRef(0);
  const styles = useThemedStyles(createStyles);
  const copy = getAccountCopy(profileLanguage);
  const languageOptions = useMemo(
    () => localizeOptions(LANGUAGE_OPTIONS, profileLanguage ?? "en"),
    [profileLanguage]
  );
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

  const handleLanguageChange = useCallback(
    async (language: Language): Promise<boolean> => {
      const previousLanguage = profileLanguage ?? "en";
      const requestId = languageSaveRequestRef.current + 1;
      languageSaveRequestRef.current = requestId;
      setLanguageSaveError(null);
      applyProfileLanguage(language);

      if (!user?.id) {
        return true;
      }

      const result = await updateProfileLanguage(user.id, language);

      if (
        !shouldApplyLanguageSaveResult({
          requestId,
          latestRequestId: languageSaveRequestRef.current
        })
      ) {
        return true;
      }

      if (!result.ok) {
        applyProfileLanguage(previousLanguage);
        setLanguageSaveError(
          localized(
            {
              en: "Could not save your language. Your previous language was restored.",
              fr: "Impossible d'enregistrer votre langue. La langue précédente a été restaurée."
            },
            previousLanguage
          )
        );
        return false;
      }

      await recordLanguageChangeNotice(AsyncStorage, language);
      await refreshAuthState();
      return true;
    },
    [applyProfileLanguage, profileLanguage, refreshAuthState, user?.id]
  );

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

    // The account no longer exists server-side, so the local session is dead
    // too: clear it and let the redirect below take the reader to login rather
    // than leaving them on a screen for an account that is gone.
    setDeleteModalVisible(false);
    setDeleteRequestMessage(copy.deletionCompleted);
    await signOut();
  }, [copy.deletionCompleted, copy.noActiveUser, signOut, user?.id]);

  if (status === "signedOut") {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <AppScreen>
      <AppScreen.Header>
        <View style={styles.headerCopy}>
          <AppText color="muted" variant="eyebrow">{copy.eyebrow}</AppText>
          <AppText variant="title">{copy.title}</AppText>
          <AppText color="muted" variant="body">
            {copy.description}
          </AppText>
        </View>
      </AppScreen.Header>

      <AppScreen.Body>
        <AccountIdentityCard
          email={user?.email ?? copy.noActiveUser}
          language={formatLanguageName(profileLanguage, profileLanguage)}
          languageLabel={copy.dailyDropLanguage}
          status={profileCompleted ? copy.complete : copy.finishOnboarding}
          statusLabel={copy.accountStatus}
          statusValue={profileCompleted ? copy.accountReady : copy.accountSetupRequired}
        />

        <SettingsSection
          description={copy.contentDescription}
          iconName="layers"
          title={copy.contentTitle}
        >
          <PreferencesEditor
            onLanguageChange={handleLanguageChange}
            onSaved={refreshAuthState}
            refreshKey={preferencesRefreshKey}
            showLanguage={false}
            uiLanguage={profileLanguage}
            userId={user?.id ?? null}
          />

          <LearningAccountSection
            language={profileLanguage}
            onCreate={() => router.push("/(learning)/setup" as Href)}
            onHistory={() => router.push("/(learning)/history" as Href)}
            onOverview={() => router.push("/(learning)/overview" as Href)}
            onReplace={() =>
              router.push(
                { pathname: "/(learning)/setup", params: { replace: "1" } } as unknown as Href
              )
            }
          />
        </SettingsSection>

        <SettingsSection
          description={copy.appDescription}
          iconName="sliders"
          title={copy.appTitle}
        >
          <Card tone="muted">
            <View style={styles.connectionCard}>
              <SettingsRow
                iconName="globe"
                label={copy.languageTitle}
                value={formatLanguageName(profileLanguage, profileLanguage)}
              />
              <View style={styles.languageChoices}>
                {languageOptions.map((option) => (
                  <SelectableCard
                    description={option.description}
                    disabled={false}
                    key={option.id}
                    label={option.label}
                    onPress={() => {
                      void handleLanguageChange(option.id);
                    }}
                    selected={(profileLanguage ?? "en") === option.id}
                  />
                ))}
              </View>
            </View>
          </Card>
          <NotificationPreferencesCard
            language={profileLanguage}
            refreshKey={preferencesRefreshKey}
            userId={user?.id ?? null}
          />
          <Card tone="muted">
            <SettingsRow
              iconName="moon"
              label={copy.appearanceTitle}
              value={copy.appearanceSystem}
            />
          </Card>
        </SettingsSection>

        <SettingsSection
          description={copy.accountDescription}
          iconName="shield"
          title={copy.accountTitle}
        >
          <Card tone="muted">
            <View style={styles.connectionCard}>
              <SettingsRow
                iconName="mail"
                label={copy.emailLabel}
                value={user?.email ?? copy.noActiveUser}
              />
              <View style={styles.linkActions}>
                <SecondaryButton
                  label={copy.resetPassword}
                  onPress={() => router.push("/(auth)/reset-password" as Href)}
                />
                <SecondaryButton
                  label={copy.privacyPolicy}
                  onPress={() => router.push("/privacy" as Href)}
                />
                <SecondaryButton
                  label={copy.support}
                  onPress={() => router.push("/support" as Href)}
                />
                <SecondaryButton
                  disabled={isExportingData}
                  label={copy.exportData}
                  onPress={handleExportData}
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
                  {getUserFacingError(privacyActionError, profileLanguage, "account").message}
                </AppText>
              ) : null}
            </View>
          </Card>
        </SettingsSection>

        {userFacingAccountError ? (
          <AppText color="danger" variant="body">
            {userFacingAccountError.message}
          </AppText>
        ) : null}

        {languageSaveError ? (
          <AppText color="danger" variant="body">
            {languageSaveError}
          </AppText>
        ) : null}

        <SettingsSection
          description={copy.sessionDescription}
          iconName="log-out"
          title={copy.sessionTitle}
        >
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
        </SettingsSection>

        <SettingsSection
          description={copy.dangerDescription}
          iconName="alert-triangle"
          title={copy.dangerTitle}
          tone="danger"
        >
          <Card tone="muted">
            <View style={styles.connectionCard}>
              <SettingsRow
                iconName="trash-2"
                label={copy.deleteAccount}
                value={copy.deleteAccountDescription}
                tone="danger"
              />
              <SecondaryButton
                label={copy.deleteAccount}
                onPress={() => setDeleteModalVisible(true)}
              />
            </View>
          </Card>
        </SettingsSection>

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

function AccountIdentityCard({
  email,
  language,
  languageLabel,
  status,
  statusLabel,
  statusValue
}: {
  email: string;
  language: string;
  languageLabel: string;
  status: string;
  statusLabel: string;
  statusValue: string;
}) {
  const styles = useThemedStyles(createStyles);
  const initial = email.trim().charAt(0).toUpperCase() || "P";

  return (
    <Card elevated padding="lg" style={styles.heroCard}>
      <View style={styles.identityTopline}>
        <View style={styles.avatar}>
          <AppText color="accentInk" variant="subtitle">
            {initial}
          </AppText>
        </View>
        <View style={styles.identityCopy}>
          <AppText numberOfLines={1} variant="subtitle">
            {email}
          </AppText>
          <AppText color="muted" variant="body">
            {status}
          </AppText>
        </View>
      </View>
      <View style={styles.identityMeta}>
        <SettingsRow iconName="globe" label={languageLabel} value={language} />
        <SettingsRow iconName="check-circle" label={statusLabel} value={statusValue} />
      </View>
    </Card>
  );
}

function SettingsSection({
  children,
  description,
  iconName,
  title,
  tone = "accent"
}: {
  children: ReactNode;
  description: string;
  iconName: IconBadgeName;
  title: string;
  tone?: "accent" | "danger";
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.settingsSection}>
      <View style={styles.settingsHeader}>
        <IconBadge name={iconName} tone={tone} />
        <View style={styles.settingsHeaderCopy}>
          <AppText color={tone === "danger" ? "danger" : "muted"} variant="eyebrow">
            {title}
          </AppText>
          <AppText color="muted" variant="caption">
            {description}
          </AppText>
        </View>
      </View>
      <View style={styles.settingsBody}>{children}</View>
    </View>
  );
}

function SettingsRow({
  iconName,
  label,
  tone = "muted",
  value
}: {
  iconName: IconBadgeName;
  label: string;
  tone?: "muted" | "danger";
  value: string;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.settingsRow}>
      <IconBadge name={iconName} size="sm" tone={tone} />
      <View style={styles.settingsRowCopy}>
        <AppText color={tone === "danger" ? "danger" : "muted"} variant="caption">
          {label}
        </AppText>
        <AppText style={styles.rowValue} variant="bodyStrong">
          {value}
        </AppText>
      </View>
    </View>
  );
}

function getAccountCopy(language: string | null) {
  const uiLanguage = language === "fr" ? "fr" : "en";

  return localized(
    {
      en: {
        eyebrow: "Settings",
        title: "Settings",
        description:
          "Change what future editions include, manage notifications, and control your account.",
        noActiveUser: "No active user",
        accountStatus: "Status",
        accountReady: "Ready",
        accountSetupRequired: "Setup required",
        complete:
          "Your setup is complete. Today will show your edition when one is available.",
        finishOnboarding: "Finish onboarding to unlock your editions.",
        dailyDropLanguage: "Reading language",
        contentTitle: "My content",
        contentDescription:
          "Enabled modules, newsletter topics, article depth, mini-case topics and learning path.",
        appTitle: "App",
        appDescription: "Language, notifications and appearance.",
        languageTitle: "Language",
        appearanceTitle: "Appearance",
        appearanceSystem: "Follows your device setting",
        accountTitle: "Account",
        accountDescription: "Email, password access, privacy and data.",
        emailLabel: "Email",
        resetPassword: "Reset password",
        sessionTitle: "Session",
        sessionDescription: "Refresh your account or sign out to use another one.",
        dangerTitle: "Danger zone",
        dangerDescription: "Permanent account actions.",
        refresh: "Refresh",
        logOut: "Log out",
        privacyTitle: "Privacy and data",
        privacyDescription:
          "Review privacy information, request a data export, or ask for account deletion.",
        privacyPolicy: "Privacy policy",
        support: "Support",
        exportData: "Export data",
        deleteAccount: "Delete account",
        deleteAccountDescription:
          "Deletes your account and saved app data after confirmation.",
        exportShareTitle: "PersoNewsAP data export",
        exportShared: "Data export opened.",
        exportShareFailed: "The data export could not be opened on this device.",
        deleteConfirmTitle: "Delete your account?",
        deleteConfirmDescription:
          "This cannot be undone. Your account, preferences, reading history, mini-case results, learning path and notification settings are deleted immediately. You will be signed out.",
        deletionCompleted: "Your account has been deleted.",
        cancel: "Cancel",
        close: "Close",
        back: "Back",
        confirmDeletion: "Delete my account"
      },
      fr: {
        eyebrow: "Réglages",
        title: "Réglages",
        description:
          "Modifiez les prochaines éditions, gérez les notifications et contrôlez votre compte.",
        noActiveUser: "Aucun utilisateur actif",
        accountStatus: "État",
        accountReady: "Prêt",
        accountSetupRequired: "Configuration requise",
        complete:
          "Votre configuration est terminée. L'écran Aujourd'hui affichera votre édition dès qu'elle sera disponible.",
        finishOnboarding: "Terminez la configuration pour débloquer vos éditions.",
        dailyDropLanguage: "Langue de lecture",
        contentTitle: "Mon contenu",
        contentDescription:
          "Modules actifs, sujets newsletter, profondeur des articles, sujets mini-cas et parcours.",
        appTitle: "App",
        appDescription: "Langue, notifications et apparence.",
        languageTitle: "Langue",
        appearanceTitle: "Apparence",
        appearanceSystem: "Suit le réglage de votre appareil",
        accountTitle: "Compte",
        accountDescription: "Email, accès au mot de passe, confidentialité et données.",
        emailLabel: "Email",
        resetPassword: "Réinitialiser le mot de passe",
        sessionTitle: "Session",
        sessionDescription: "Actualisez votre compte ou déconnectez-vous pour en utiliser un autre.",
        dangerTitle: "Zone sensible",
        dangerDescription: "Actions permanentes sur le compte.",
        refresh: "Actualiser",
        logOut: "Se déconnecter",
        privacyTitle: "Confidentialité et données",
        privacyDescription:
          "Consulte les informations de confidentialité, demande un export de données ou une suppression de compte.",
        privacyPolicy: "Politique de confidentialité",
        support: "Support",
        exportData: "Exporter les données",
        deleteAccount: "Supprimer le compte",
        deleteAccountDescription:
          "Supprime votre compte et les données enregistrées après confirmation.",
        exportShareTitle: "Export de données PersoNewsAP",
        exportShared: "Export de données ouvert.",
        exportShareFailed: "L'export de données ne peut pas être ouvert sur cet appareil.",
        deleteConfirmTitle: "Supprimer votre compte ?",
        deleteConfirmDescription:
          "Cette action est irréversible. Votre compte, vos préférences, votre historique de lecture, vos résultats de mini-cas, votre parcours et vos réglages de notification sont supprimés immédiatement. Vous serez déconnecté.",
        deletionCompleted: "Votre compte a été supprimé.",
        cancel: "Annuler",
        close: "Fermer",
        back: "Retour",
        confirmDeletion: "Supprimer mon compte"
      }
    },
    uiLanguage
  );
}

export default SettingsScreen;

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    actions: {
      gap: tokens.space.md
    },
    headerCopy: {
      gap: tokens.space.sm
    },
    heroCard: {
      gap: tokens.space.lg
    },
    avatar: {
      alignItems: "center",
      backgroundColor: c.accentSoft,
      borderColor: c.accent,
      borderRadius: tokens.radius.pill,
      borderWidth: 1,
      height: 56,
      justifyContent: "center",
      width: 56
    },
    connectionCard: {
      gap: tokens.space.md
    },
    identityCopy: {
      flex: 1,
      gap: tokens.space.xs
    },
    identityMeta: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.md,
      paddingTop: tokens.space.md
    },
    identityTopline: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md
    },
    deleteModal: {
      gap: tokens.space.lg,
      maxWidth: 420,
      width: "100%"
    },
    linkActions: {
      gap: tokens.space.sm
    },
    languageChoices: {
      gap: tokens.space.sm
    },
    modalOverlay: {
      alignItems: "center",
      backgroundColor: c.scrim,
      flex: 1,
      justifyContent: "center",
      padding: tokens.space.lg
    },
    rowValue: {
      flexShrink: 1
    },
    settingsBody: {
      gap: tokens.space.md
    },
    settingsHeader: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: tokens.space.md
    },
    settingsHeaderCopy: {
      flex: 1,
      gap: tokens.space.xs
    },
    settingsRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md
    },
    settingsRowCopy: {
      flex: 1,
      gap: tokens.space.xs
    },
    settingsSection: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.md,
      paddingTop: tokens.space.lg
    }
  });
