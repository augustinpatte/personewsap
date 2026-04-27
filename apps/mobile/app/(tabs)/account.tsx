import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { AppScreen } from "../../src/components/AppScreen";
import { AppText } from "../../src/components/AppText";
import { Card } from "../../src/components/Card";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { SecondaryButton } from "../../src/components/SecondaryButton";
import { tokens } from "../../src/design/tokens";
import { useAuth } from "../../src/features/auth";
import { normalizeSupabaseError, supabase, supabaseConfigDiagnostics } from "../../src/lib/supabase";

type ProfileSummary = {
  language: string | null;
};

export default function AccountScreen() {
  const {
    error,
    isConfigured,
    profileCompleted,
    refreshAuthState,
    session,
    signOut,
    status,
    user
  } = useAuth();
  const [profile, setProfile] = useState<ProfileSummary>({ language: null });
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!supabase || !user) {
      setProfile({ language: null });
      return;
    }

    const { data, error: fetchError } = await supabase
      .from("profiles")
      .select("language")
      .eq("id", user.id)
      .maybeSingle();

    if (fetchError) {
      setProfileError(normalizeSupabaseError(fetchError).message);
      return;
    }

    setProfileError(null);
    setProfile({
      language: data?.language ?? null
    });
  }, [user]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setSignOutError(null);

    try {
      await refreshAuthState();
      await loadProfile();
    } finally {
      setIsRefreshing(false);
    }
  }, [loadProfile, refreshAuthState]);

  const handleSignOut = useCallback(async () => {
    setIsSigningOut(true);
    setSignOutError(null);

    const result = await signOut();

    if (result.error) {
      setSignOutError(result.error.message);
    }

    setIsSigningOut(false);
  }, [signOut]);

  return (
    <AppScreen>
      <AppScreen.Header>
        <AppText variant="eyebrow">Account</AppText>
        <AppText variant="title">Profile</AppText>
        <AppText variant="body">
          Auth details for testing the daily drop flow and copying the current user id safely.
        </AppText>
      </AppScreen.Header>

      <AppScreen.Body>
        <Card>
          <AppText variant="subtitle">Signed in</AppText>
          <InfoRow label="Email" value={user?.email ?? "Unavailable"} selectable />
          <InfoRow label="TEST_USER_ID" value={user?.id ?? "Unavailable"} monospace selectable />
        </Card>

        <Card>
          <AppText variant="subtitle">Preferences</AppText>
          <InfoRow label="Language" value={profile.language ?? "Unavailable"} />
          <InfoRow label="Onboarding" value={profileCompleted ? "Complete" : onboardingLabel(status)} />
          {profileError ? <AppText color="danger" variant="caption">{profileError}</AppText> : null}
        </Card>

        <Card tone="muted">
          <AppText variant="subtitle">Developer</AppText>
          <InfoRow label="Supabase URL configured" value={supabaseConfigDiagnostics.urlHost ? "Yes" : "No"} />
          <InfoRow label="Supabase client configured" value={isConfigured ? "Yes" : "No"} />
          <InfoRow label="Current session" value={session ? "Yes" : "No"} />
          <InfoRow label="Auth status" value={status} />
          {error ? <AppText color="danger" variant="caption">{error.message}</AppText> : null}
        </Card>

        {signOutError ? <AppText color="danger" variant="body">{signOutError}</AppText> : null}

        <View style={styles.actions}>
          <SecondaryButton disabled={isRefreshing || isSigningOut} label="Refresh" onPress={handleRefresh} />
          <PrimaryButton
            disabled={isRefreshing}
            label="Log out"
            loading={isSigningOut}
            onPress={handleSignOut}
            testID="account-logout-button"
          />
        </View>
      </AppScreen.Body>
    </AppScreen>
  );
}

function onboardingLabel(status: string) {
  if (status === "needsOnboarding") {
    return "Needs onboarding";
  }

  if (status === "loading") {
    return "Checking";
  }

  return "Not complete";
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

const styles = StyleSheet.create({
  actions: {
    gap: tokens.space.md
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
