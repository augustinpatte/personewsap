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
import { useAuth } from "../../src/features/auth";
import {
  getSupabaseConfigError,
  hasSupabaseConfig,
  requestPasswordReset,
  updatePassword,
  type NormalizedSupabaseError
} from "../../src/lib/supabase";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { refreshAuthState, session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<NormalizedSupabaseError | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isRecoverySession = Boolean(session);
  const canRequestReset = useMemo(() => email.trim().includes("@"), [email]);
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
          message:
            "Sign-in is not set up for this build."
        }
      );
      return;
    }

    setIsSubmitting(true);
    const result = await requestPasswordReset(email);
    setIsSubmitting(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    setMessage("If this email has an account, a secure reset link will be sent.");
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
            <AppText variant="eyebrow">Auth</AppText>
            <AppText variant="title">
              {isRecoverySession ? "Set a new password" : "Reset your password"}
            </AppText>
            <AppText color="muted" variant="body">
              {isRecoverySession
                ? "Choose a new password for your PersoNewsAP account."
                : "Enter your email and we will send a secure reset link."}
            </AppText>
          </View>

          {!hasSupabaseConfig ? (
            <EmptyState
              description="Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo."
              eyebrow="Developer/Test setup"
              title="Sign-in setup needed"
              style={styles.inlineState}
            />
          ) : null}

          {isRecoverySession ? (
            <View style={styles.fields}>
              <View style={styles.field}>
                <AppText variant="label">New password</AppText>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="new-password"
                  onChangeText={setPassword}
                  placeholder="Minimum 8 characters"
                  placeholderTextColor={tokens.color.mutedSoft}
                  secureTextEntry
                  style={styles.input}
                  textContentType="newPassword"
                  value={password}
                />
              </View>
              <View style={styles.field}>
                <AppText variant="label">Confirm new password</AppText>
                <TextInput
                  autoCapitalize="none"
                  autoComplete="new-password"
                  onChangeText={setConfirmPassword}
                  placeholder="Repeat password"
                  placeholderTextColor={tokens.color.mutedSoft}
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
              <AppText variant="label">Email</AppText>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                inputMode="email"
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={tokens.color.mutedSoft}
                returnKeyType="send"
                style={styles.input}
                textContentType="emailAddress"
                value={email}
                onSubmitEditing={canRequestReset && !isSubmitting ? requestReset : undefined}
              />
            </View>
          )}

          {error ? <AuthResetMessage error={error} /> : null}
          {message ? (
            <View style={styles.successBox}>
              <AppText color="success" variant="label">
                Reset email requested
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
                label={isSubmitting ? "Saving..." : "Save new password"}
                loading={isSubmitting}
                onPress={saveNewPassword}
              />
            ) : (
              <PrimaryButton
                disabled={!canRequestReset || isSubmitting}
                label={isSubmitting ? "Sending..." : "Send reset link"}
                loading={isSubmitting}
                onPress={requestReset}
              />
            )}
            <SecondaryButton label="Back to login" onPress={() => router.replace("/(auth)/login")} />
          </View>
        </Card>
      </AppScreen>
    </KeyboardAvoidingView>
  );
}

function AuthResetMessage({ error }: { error: NormalizedSupabaseError }) {
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
          Developer/Test code: {error.code}
        </AppText>
      ) : null}
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
  },
  successBox: {
    backgroundColor: tokens.color.successSoft,
    borderColor: tokens.color.success,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    gap: tokens.space.xs,
    padding: tokens.space.md
  }
});
