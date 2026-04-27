import { useMemo, useState, type ComponentProps } from "react";
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
} from "../../components";
import type { NormalizedSupabaseError } from "../../lib/supabase";
import { tokens } from "../../design/tokens";
import { useAuth } from "./AuthProvider";

type AuthMode = "login" | "signup";

type AuthFormScreenProps = {
  mode: AuthMode;
};

export function AuthFormScreen({ mode }: AuthFormScreenProps) {
  const router = useRouter();
  const { error: authError, isConfigured, signInWithEmail, signUpWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<NormalizedSupabaseError | null>(null);

  const isSignup = mode === "signup";
  const title = isSignup ? "Create your account" : "Welcome back";
  const description = isSignup
    ? "Use email and password for the first mobile build. Preferences come next."
    : "Log in to continue your daily briefing.";
  const primaryLabel = isSignup ? "Create account" : "Log in";
  const secondaryLabel = isSignup ? "I already have an account" : "Create an account";
  const formValid = useMemo(() => {
    const hasRequiredFields = email.trim().length > 3 && password.length >= 8;
    return isSignup
      ? hasRequiredFields && password === confirmPassword
      : hasRequiredFields;
  }, [confirmPassword, email, isSignup, password]);

  const submit = async () => {
    setMessage(null);
    setFormError(null);

    if (!isConfigured) {
      setFormError(
        authError ?? {
          code: "missing_supabase_config",
          message:
            "Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
        }
      );
      return;
    }

    if (isSignup && password !== confirmPassword) {
      setFormError({ code: "password_mismatch", message: "Passwords do not match." });
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
      setMessage("Check your email to confirm the account, then log in.");
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
                description="Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env. If you just changed them, restart Expo so the public env vars are bundled."
                eyebrow="Configuration"
                title="Supabase auth is not ready"
                style={styles.inlineState}
              />
            ) : null}
            <LabeledInput
              autoCapitalize="none"
              autoComplete="email"
              inputMode="email"
              label="Email"
              onChangeText={setEmail}
              placeholder="you@example.com"
              textContentType="emailAddress"
              value={email}
            />
            <LabeledInput
              autoCapitalize="none"
              autoComplete={isSignup ? "new-password" : "current-password"}
              label="Password"
              onChangeText={setPassword}
              placeholder="Minimum 8 characters"
              secureTextEntry
              textContentType={isSignup ? "newPassword" : "password"}
              value={password}
            />
            {isSignup ? (
              <LabeledInput
                autoCapitalize="none"
                autoComplete="new-password"
                label="Confirm password"
                onChangeText={setConfirmPassword}
                placeholder="Repeat password"
                secureTextEntry
                textContentType="newPassword"
                value={confirmPassword}
              />
            ) : null}
          </View>

          {formError ? (
            <AuthErrorMessage error={formError} />
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
          </View>
        </Card>
      </AppScreen>
    </KeyboardAvoidingView>
  );
}

function AuthErrorMessage({ error }: { error: NormalizedSupabaseError }) {
  return (
    <View style={styles.errorBox}>
      <AppText color="danger" variant="label">
        {error.message}
      </AppText>
      {error.hint ? (
        <AppText color="muted" variant="caption">
          {error.hint}
        </AppText>
      ) : null}
      {error.code ? (
        <AppText color="muted" variant="caption">
          Code: {error.code}
        </AppText>
      ) : null}
    </View>
  );
}

type LabeledInputProps = ComponentProps<typeof TextInput> & {
  label: string;
};

function LabeledInput({ label, style, ...inputProps }: LabeledInputProps) {
  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        {...inputProps}
        placeholderTextColor={tokens.color.mutedSoft}
        style={[styles.input, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: tokens.color.backgroundRaised,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    color: tokens.color.ink,
    fontSize: tokens.typography.size.body,
    minHeight: 52,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.md
  },
  actions: {
    gap: tokens.space.sm
  },
  errorBox: {
    backgroundColor: tokens.color.dangerSoft,
    borderColor: tokens.color.danger,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    gap: tokens.space.xs,
    padding: tokens.space.md
  }
});
