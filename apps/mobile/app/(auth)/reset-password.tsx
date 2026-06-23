import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View
} from "react-native";
import { useRouter } from "expo-router";

import {
  AppScreen,
  AppText,
  Card,
  EmptyState,
  PrimaryButton,
  SecondaryButton
} from "../../src/components";
import { tokens } from "../../src/design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../src/design/theme";
import { useAuth } from "../../src/features/auth";
import { localized } from "../../src/lib/i18n";
import {
  getSupabaseConfigError,
  hasSupabaseConfig,
  requestPasswordReset,
  updatePassword,
  type NormalizedSupabaseError
} from "../../src/lib/supabase";
import { getUserFacingError } from "../../src/lib/userFacingErrors";
import type { Language } from "../../src/types/domain";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { profileLanguage, refreshAuthState, session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<NormalizedSupabaseError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const isRecoverySession = Boolean(session);
  const copy = getResetPasswordCopy(profileLanguage);
  const canRequestReset = useMemo(() => isValidAuthEmail(email), [email]);
  const canUpdatePassword = useMemo(
    () => password.length >= 8 && password === confirmPassword,
    [confirmPassword, password]
  );

  const requestReset = async () => {
    setError(null);
    setMessage(null);

    if (!hasSupabaseConfig) {
      setError(
        getSupabaseConfigError() ?? {
          code: "missing_supabase_config",
          message: copy.signInNotSetup
        }
      );
      return;
    }

    if (!isValidAuthEmail(email)) {
      setError({ code: "invalid_email", message: "Invalid email address." });
      return;
    }

    setIsSubmitting(true);
    const result = await requestPasswordReset(email);
    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setMessage(copy.resetLinkSent);
  };

  const saveNewPassword = async () => {
    setError(null);
    setMessage(null);

    if (password !== confirmPassword) {
      setError({ code: "password_mismatch", message: "Passwords do not match." });
      return;
    }

    setIsSubmitting(true);
    const result = await updatePassword(password);
    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    await refreshAuthState();
    router.replace("/");
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.keyboard}
    >
      <AppScreen centered>
        <Card elevated padding="lg" style={styles.card}>
          <View style={styles.copy}>
            <AppText variant="eyebrow">{copy.eyebrow}</AppText>
            <AppText variant="title">
              {isRecoverySession ? copy.newPasswordTitle : copy.resetPasswordTitle}
            </AppText>
            <AppText color="muted" variant="body">
              {isRecoverySession
                ? copy.newPasswordDescription
                : copy.resetPasswordDescription}
            </AppText>
          </View>

          {!hasSupabaseConfig ? (
            <EmptyState
              description={copy.accountUnavailableDescription}
              eyebrow={copy.accountEyebrow}
              title={copy.passwordResetUnavailable}
              style={styles.inlineState}
            />
          ) : null}

          {isRecoverySession ? (
            <View style={styles.fields}>
              <View style={styles.field}>
                <AppText variant="label">{copy.newPassword}</AppText>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="new-password"
                  onChangeText={setPassword}
                  placeholder={copy.passwordPlaceholder}
                  placeholderTextColor={colors.mutedSoft}
                  secureTextEntry
                  style={styles.input}
                  textContentType="newPassword"
                  value={password}
                />
              </View>
              <View style={styles.field}>
                <AppText variant="label">{copy.confirmNewPassword}</AppText>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="new-password"
                  onChangeText={setConfirmPassword}
                  placeholder={copy.repeatPassword}
                  placeholderTextColor={colors.mutedSoft}
                  returnKeyType="done"
                  secureTextEntry
                  style={styles.input}
                  textContentType="newPassword"
                  value={confirmPassword}
                  onSubmitEditing={
                    canUpdatePassword && !isSubmitting ? saveNewPassword : undefined
                  }
                />
              </View>
            </View>
          ) : (
            <View style={styles.field}>
              <AppText variant="label">{copy.email}</AppText>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                inputMode="email"
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedSoft}
                returnKeyType="send"
                style={styles.input}
                textContentType="emailAddress"
                value={email}
                onSubmitEditing={canRequestReset && !isSubmitting ? requestReset : undefined}
              />
            </View>
          )}

          {error ? <AuthResetMessage error={error} language={profileLanguage} /> : null}
          {message ? (
            <View style={styles.successBox}>
              <AppText color="success" variant="label">
                {copy.resetEmailRequested}
              </AppText>
              <AppText color="muted" variant="caption">
                {message}
              </AppText>
            </View>
          ) : null}

          <View style={styles.actions}>
            {isRecoverySession ? (
              <PrimaryButton
                disabled={!canUpdatePassword || isSubmitting}
                label={isSubmitting ? copy.saving : copy.saveNewPassword}
                loading={isSubmitting}
                onPress={saveNewPassword}
              />
            ) : (
              <PrimaryButton
                disabled={!canRequestReset || isSubmitting}
                label={isSubmitting ? copy.sending : copy.sendResetLink}
                loading={isSubmitting}
                onPress={requestReset}
              />
            )}
            <SecondaryButton
              label={isRecoverySession ? copy.skipForNow : copy.backToLogin}
              onPress={() => router.replace(isRecoverySession ? "/" : "/(auth)/login")}
            />
          </View>
        </Card>
      </AppScreen>
    </KeyboardAvoidingView>
  );
}

function AuthResetMessage({
  error,
  language
}: {
  error: NormalizedSupabaseError;
  language: Language | null | undefined;
}) {
  const styles = useThemedStyles(createStyles);
  const userFacingError = getUserFacingError(error, language, "password");

  return (
    <View style={styles.errorBox}>
      <AppText color="danger" variant="label">
        {userFacingError.title}
      </AppText>
      <AppText color="muted" variant="caption">
        {userFacingError.message}
      </AppText>
    </View>
  );
}

function isValidAuthEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getResetPasswordCopy(language: Language | null | undefined) {
  return localized(
    {
      en: {
        accountEyebrow: "Account",
        accountUnavailableDescription:
          "Account features are unavailable right now. Please try again later.",
        backToLogin: "Back to login",
        confirmNewPassword: "Confirm new password",
        email: "Email",
        eyebrow: "Account",
        newPassword: "New password",
        newPasswordDescription: "Choose a new password for your PersoNewsAP account.",
        newPasswordTitle: "Set a new password",
        passwordPlaceholder: "Minimum 8 characters",
        passwordResetUnavailable: "Password reset unavailable",
        repeatPassword: "Repeat password",
        resetEmailRequested: "Reset email requested",
        resetLinkSent: "If this email has an account, a secure reset link will be sent.",
        resetPasswordDescription: "Enter your email and we will send a secure reset link.",
        resetPasswordTitle: "Reset your password",
        saveNewPassword: "Save new password",
        saving: "Saving...",
        sendResetLink: "Send reset link",
        sending: "Sending...",
        signInNotSetup: "Sign-in is not set up for this build.",
        skipForNow: "Skip for now"
      },
      fr: {
        accountEyebrow: "Compte",
        accountUnavailableDescription:
          "Les fonctions de compte sont indisponibles pour le moment. Réessaie plus tard.",
        backToLogin: "Retour à la connexion",
        confirmNewPassword: "Confirmer le nouveau mot de passe",
        email: "Email",
        eyebrow: "Compte",
        newPassword: "Nouveau mot de passe",
        newPasswordDescription: "Choisis un nouveau mot de passe pour ton compte PersoNewsAP.",
        newPasswordTitle: "Définis un nouveau mot de passe",
        passwordPlaceholder: "Minimum 8 caractères",
        passwordResetUnavailable: "Réinitialisation indisponible",
        repeatPassword: "Répète le mot de passe",
        resetEmailRequested: "Email de réinitialisation demandé",
        resetLinkSent:
          "Si cet email correspond à un compte, un lien sécurisé de réinitialisation sera envoyé.",
        resetPasswordDescription:
          "Entre ton email et nous t'enverrons un lien sécurisé de réinitialisation.",
        resetPasswordTitle: "Réinitialise ton mot de passe",
        saveNewPassword: "Enregistrer le nouveau mot de passe",
        saving: "Enregistrement...",
        sendResetLink: "Envoyer le lien",
        sending: "Envoi...",
        signInNotSetup: "La connexion n'est pas configurée pour cette version.",
        skipForNow: "Passer pour l'instant"
      }
    },
    language
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    keyboard: {
      flex: 1
    },
    card: {
      gap: tokens.space.lg
    },
    copy: {
      gap: tokens.space.sm
    },
    inlineState: {
      padding: tokens.space.lg
    },
    fields: {
      gap: tokens.space.md
    },
    field: {
      gap: tokens.space.sm
    },
    input: {
      backgroundColor: c.backgroundRaised,
      borderColor: c.border,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      color: c.ink,
      fontSize: tokens.typography.size.body,
      minHeight: 52,
      paddingHorizontal: tokens.space.md,
      paddingVertical: tokens.space.md
    },
    actions: {
      gap: tokens.space.sm
    },
    errorBox: {
      backgroundColor: c.dangerSoft,
      borderColor: c.danger,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      gap: tokens.space.xs,
      padding: tokens.space.md
    },
    successBox: {
      backgroundColor: c.successSoft,
      borderColor: c.success,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      gap: tokens.space.xs,
      padding: tokens.space.md
    }
  });
