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
  PrimaryButton,
  SecondaryButton
} from "../../components";
import { tokens } from "../../design/tokens";
import { useAuth } from "./AuthProvider";

type AuthMode = "login" | "signup";

type AuthFormScreenProps = {
  mode: AuthMode;
};

export function AuthFormScreen({ mode }: AuthFormScreenProps) {
  const router = useRouter();
  const { isConfigured, signInWithEmail, signUpWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
      setFormError("Supabase is not configured for this mobile app yet.");
      return;
    }

    if (isSignup && password !== confirmPassword) {
      setFormError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);

    const result = isSignup
      ? await signUpWithEmail({ email, password })
      : await signInWithEmail({ email, password });

    setIsSubmitting(false);

    if (result.error) {
      setFormError(result.error.message);
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
            <AppText color="danger" variant="caption">
              {formError}
            </AppText>
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
  }
});
