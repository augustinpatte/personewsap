import { useEffect, useMemo, useState, type ComponentProps } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View
} from "react-native";
import { useRouter, type Href } from "expo-router";

import {
  AppScreen,
  AppText,
  Card,
  EmptyState,
  PrimaryButton,
  SecondaryButton
} from "../../components";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { localized } from "../../lib/i18n";
import type { NormalizedSupabaseError } from "../../lib/supabase";
import { getUserFacingError } from "../../lib/userFacingErrors";
import type { Language } from "../../types/domain";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { useAuth } from "./AuthProvider";

type AuthMode = "login" | "signup";

type AuthFormScreenProps = {
  mode: AuthMode;
};

export function AuthFormScreen({ mode }: AuthFormScreenProps) {
  const router = useRouter();
  const {
    error: authError,
    isConfigured,
    profileLanguage,
    signInWithEmail,
    signUpWithEmail
  } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<NormalizedSupabaseError | null>(null);
  const styles = useThemedStyles(createStyles);

  const isSignup = mode === "signup";
  const copy = getAuthFormCopy(profileLanguage);
  const title = isSignup ? copy.signupTitle : copy.loginTitle;
  const description = isSignup ? copy.signupDescription : copy.loginDescription;
  const primaryLabel = isSignup ? copy.createAccount : copy.logIn;
  const secondaryLabel = isSignup ? copy.alreadyHaveAccount : copy.createAccount;
  const formHint = getFormHint({
    confirmPassword,
    copy,
    email,
    isSignup,
    password
  });
  const formValid = useMemo(() => {
    const hasRequiredFields = isValidAuthEmail(email) && password.length >= 8;
    return isSignup
      ? hasRequiredFields && password === confirmPassword
      : hasRequiredFields;
  }, [confirmPassword, email, isSignup, password]);

  useEffect(() => {
    if (formError) {
      trackAnalyticsEvent("error_viewed");
    }
  }, [formError]);

  useEffect(() => {
    if (!isConfigured) {
      trackAnalyticsEvent("error_viewed");
    }
  }, [isConfigured]);

  const submit = async () => {
    setMessage(null);
    setFormError(null);

    if (!isConfigured) {
      setFormError(
        authError ?? {
          code: "missing_supabase_config",
          message: copy.signInNotSetup
        }
      );
      return;
    }

    if (isSignup && password !== confirmPassword) {
      setFormError({ code: "password_mismatch", message: "Passwords do not match." });
      return;
    }

    if (!isValidAuthEmail(email)) {
      setFormError({ code: "invalid_email", message: "Invalid email address." });
      return;
    }

    setIsSubmitting(true);

    const result = isSignup
      ? await signUpWithEmail({ email, password })
      : await signInWithEmail({ email, password });

    setIsSubmitting(false);

    if (result.error) {
      setFormError(result.error);
      return;
    }

    if (result.needsEmailConfirmation) {
      setMessage(copy.emailConfirmationSent);
      return;
    }

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
            <AppText variant="eyebrow">PersoNewsAP</AppText>
            <AppText variant="title">{title}</AppText>
            <AppText color="muted" variant="body">
              {description}
            </AppText>
          </View>

          <View style={styles.fields}>
            {!isConfigured ? (
              <EmptyState
                description={copy.accountUnavailableDescription}
                eyebrow={copy.accountEyebrow}
                title={copy.signInUnavailable}
                style={styles.inlineState}
              />
            ) : null}
            <LabeledInput
              autoCapitalize="none"
              autoComplete="email"
              inputMode="email"
              label={copy.email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              textContentType="emailAddress"
              value={email}
            />
            <LabeledInput
              autoCapitalize="none"
              autoComplete={isSignup ? "new-password" : "current-password"}
              label={copy.password}
              onChangeText={setPassword}
              placeholder={copy.passwordPlaceholder}
              secureTextEntry
              textContentType={isSignup ? "newPassword" : "password"}
              value={password}
            />
            {isSignup ? (
              <LabeledInput
                autoCapitalize="none"
                autoComplete="new-password"
                label={copy.confirmPassword}
                onChangeText={setConfirmPassword}
                placeholder={copy.repeatPassword}
                secureTextEntry
                textContentType="newPassword"
                value={confirmPassword}
              />
            ) : null}
            {formHint ? (
              <AppText color="muted" variant="caption">
                {formHint}
              </AppText>
            ) : null}
          </View>

          {formError ? (
            <AuthErrorMessage error={formError} language={profileLanguage} />
          ) : null}
          {message ? (
            <AppText color="success" variant="caption">
              {message}
            </AppText>
          ) : null}

          <View style={styles.actions}>
            <PrimaryButton
              disabled={!formValid || isSubmitting}
              label={primaryLabel}
              loading={isSubmitting}
              onPress={submit}
            />
            <SecondaryButton
              label={secondaryLabel}
              onPress={() =>
                router.replace(isSignup ? "/(auth)/login" : "/(auth)/signup")
              }
            />
            {!isSignup ? (
              <SecondaryButton
                label={copy.resetPassword}
                onPress={() => router.replace("/(auth)/reset-password")}
              />
            ) : null}
            <SecondaryButton
              label={copy.privacyPolicy}
              onPress={() => router.push("/privacy" as Href)}
            />
          </View>

          {isSignup ? (
            <AppText color="muted" style={styles.privacyNotice} variant="caption">
              {copy.privacyNotice}
            </AppText>
          ) : null}
        </Card>
      </AppScreen>
    </KeyboardAvoidingView>
  );
}

function getFormHint({
  confirmPassword,
  copy,
  email,
  isSignup,
  password
}: {
  confirmPassword: string;
  copy: ReturnType<typeof getAuthFormCopy>;
  email: string;
  isSignup: boolean;
  password: string;
}) {
  if (!isValidAuthEmail(email)) {
    return copy.emailHint;
  }

  if (password.length > 0 && password.length < 8) {
    return copy.passwordHint;
  }

  if (isSignup && confirmPassword.length > 0 && password !== confirmPassword) {
    return copy.passwordsNeedMatch;
  }

  return null;
}

function isValidAuthEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function AuthErrorMessage({
  error,
  language
}: {
  error: NormalizedSupabaseError;
  language: Language | null | undefined;
}) {
  const styles = useThemedStyles(createStyles);
  const userFacingError = getUserFacingError(error, language, "auth");

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

function getAuthFormCopy(language: Language | null | undefined) {
  return localized(
    {
      en: {
        accountEyebrow: "Account",
        accountUnavailableDescription:
          "Account features are unavailable right now. Please try again later.",
        alreadyHaveAccount: "I already have an account",
        confirmPassword: "Confirm password",
        createAccount: "Create account",
        email: "Email",
        emailConfirmationSent: "Check your email to confirm the account, then log in.",
        emailHint: "Enter the email you want to use for PersoNewsAP.",
        logIn: "Log in",
        loginDescription: "Log in to continue your five-minute daily briefing.",
        loginTitle: "Welcome back",
        password: "Password",
        passwordHint: "Password must be at least 8 characters.",
        passwordPlaceholder: "Minimum 8 characters",
        passwordsNeedMatch: "Passwords need to match before you can continue.",
        privacyNotice:
          "By creating an account, you can review how PersoNewsAP uses your account and learning data in the Privacy Policy.",
        privacyPolicy: "Privacy Policy",
        repeatPassword: "Repeat password",
        resetPassword: "Reset password",
        signInNotSetup: "Sign-in is not set up for this build.",
        signInUnavailable: "Sign-in unavailable",
        signupDescription:
          "Create an account, then set up the daily drop you want to receive.",
        signupTitle: "Create your account"
      },
      fr: {
        accountEyebrow: "Compte",
        accountUnavailableDescription:
          "Les fonctions de compte sont indisponibles pour le moment. Réessaie plus tard.",
        alreadyHaveAccount: "J'ai déjà un compte",
        confirmPassword: "Confirmer le mot de passe",
        createAccount: "Créer un compte",
        email: "Email",
        emailConfirmationSent: "Vérifie ton email pour confirmer le compte, puis connecte-toi.",
        emailHint: "Entre l'email que tu veux utiliser pour PersoNewsAP.",
        logIn: "Se connecter",
        loginDescription: "Connecte-toi pour continuer ton briefing quotidien de cinq minutes.",
        loginTitle: "Bon retour",
        password: "Mot de passe",
        passwordHint: "Le mot de passe doit contenir au moins 8 caractères.",
        passwordPlaceholder: "Minimum 8 caractères",
        passwordsNeedMatch: "Les mots de passe doivent correspondre pour continuer.",
        privacyNotice:
          "En créant un compte, tu peux consulter l'utilisation de tes données de compte et d'apprentissage dans la Politique de confidentialité.",
        privacyPolicy: "Politique de confidentialité",
        repeatPassword: "Répète le mot de passe",
        resetPassword: "Réinitialiser le mot de passe",
        signInNotSetup: "La connexion n'est pas configurée pour cette version.",
        signInUnavailable: "Connexion indisponible",
        signupDescription:
          "Crée un compte, puis configure la mise à jour quotidienne que tu veux recevoir.",
        signupTitle: "Crée ton compte"
      }
    },
    language
  );
}

type LabeledInputProps = ComponentProps<typeof TextInput> & {
  label: string;
};

function LabeledInput({ label, style, ...inputProps }: LabeledInputProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        {...inputProps}
        placeholderTextColor={colors.mutedSoft}
        style={[styles.input, style]}
      />
    </View>
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
    fields: {
      gap: tokens.space.md
    },
    inlineState: {
      padding: tokens.space.lg
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
    privacyNotice: {
      textAlign: "center"
    },
    errorBox: {
      backgroundColor: c.dangerSoft,
      borderColor: c.danger,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      gap: tokens.space.xs,
      padding: tokens.space.md
    }
  });
