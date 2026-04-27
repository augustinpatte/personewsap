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
import { normalizeSupabaseError, supabase, supabaseConfigDiagnostics } from "../../src/lib/supabase";

type ProfileSummary = {
  language: string | null;
};

export default function AccountScreen() {
  const router = useRouter();
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
          <AppText variant="eyebrow">Account</AppText>
          <ProgressPill
            label={session ? "Signed in" : "Signed out"}
            tone={session ? "success" : "neutral"}
          />
        </View>
        <View style={styles.headerCopy}>
          <AppText variant="title">Settings</AppText>
          <AppText variant="body">
            Manage your session, preferences, and tester information for assigned daily drops.
          </AppText>
        </View>
      </AppScreen.Header>

      <AppScreen.Body>
        <Card elevated padding="lg" style={styles.heroCard}>
          <View style={styles.cardTopline}>
            <AppText variant="subtitle">{user?.email ?? "No active user"}</AppText>
            <ProgressPill
              label={profileCompleted ? "Ready" : onboardingLabel(status)}
              tone={profileCompleted ? "success" : "warning"}
            />
          </View>
          <AppText color="muted" variant="body">
            This account is ready for the daily drop flow once onboarding and live content are available.
          </AppText>
        </Card>

        <Card>
          <View style={styles.cardTopline}>
            <AppText variant="subtitle">Preferences</AppText>
            <ProgressPill label={profile.language?.toUpperCase() ?? "No language"} tone="neutral" />
          </View>
          <InfoRow label="Email" value={user?.email ?? "Unavailable"} selectable />
          <InfoRow label="Language" value={profile.language ?? "Unavailable"} />
          <InfoRow label="Onboarding" value={profileCompleted ? "Complete" : onboardingLabel(status)} />
          {profileError ? <AppText color="danger" variant="caption">{profileError}</AppText> : null}
        </Card>

        <Card tone="muted">
          <View style={styles.cardTopline}>
            <AppText variant="subtitle">Developer/Test info</AppText>
            <ProgressPill label={isConfigured ? "Configured" : "Needs env"} tone={isConfigured ? "success" : "warning"} />
          </View>
          <AppText color="muted" variant="body">
            Select and copy this user id when assigning a test daily drop from the content engine.
          </AppText>
          <View style={styles.idBox}>
            <AppText color="muted" variant="caption">
              User id for TEST_USER_ID
            </AppText>
            <AppText selectable style={styles.idValue} variant="bodyStrong">
              {user?.id ?? "Unavailable"}
            </AppText>
          </View>
          <InfoRow label="Live data host" value={supabaseConfigDiagnostics.urlHost ?? "Unavailable"} />
          <InfoRow label="Live data connection" value={isConfigured ? "Configured" : "Needs env"} />
          <InfoRow label="Current session" value={session ? "Active" : "Not signed in"} />
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
  idBox: {
    backgroundColor: tokens.color.backgroundRaised,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    gap: tokens.space.xs,
    padding: tokens.space.md
  },
  idValue: {
    fontFamily: "Courier",
    fontSize: 13,
    lineHeight: 19
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
