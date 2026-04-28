import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { AppScreen } from "../../src/components/AppScreen";
import { AppText } from "../../src/components/AppText";
import { Card } from "../../src/components/Card";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { ProgressPill } from "../../src/components/ProgressPill";
import { SecondaryButton } from "../../src/components/SecondaryButton";
import { tokens } from "../../src/design/tokens";
import { useAuth } from "../../src/features/auth";
import { PreferencesEditor } from "../../src/features/preferences";
import { supabaseConfigDiagnostics } from "../../src/lib/supabase";

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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [preferencesRefreshKey, setPreferencesRefreshKey] = useState(0);
  const [showDeveloperInfo, setShowDeveloperInfo] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

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
            Manage your PersoNewsAP account and check that your daily learning setup is ready.
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
            {profileCompleted
              ? "Your onboarding is complete. Today will show a live assigned drop when one is available."
              : "Finish onboarding to unlock your daily drop."}
          </AppText>
        </Card>

        <PreferencesEditor
          onSaved={refreshAuthState}
          refreshKey={preferencesRefreshKey}
          userId={user?.id ?? null}
        />

        <Card tone="muted">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showDeveloperInfo }}
            onPress={() => setShowDeveloperInfo((isVisible) => !isVisible)}
            style={styles.developerToggle}
          >
            <View style={styles.developerToggleCopy}>
              <AppText variant="subtitle">Developer/Test info</AppText>
              <AppText color="muted" variant="caption">
                User id and live-data diagnostics for test setup.
              </AppText>
            </View>
            <ProgressPill
              label={showDeveloperInfo ? "Hide" : "Show"}
              tone={isConfigured ? "neutral" : "warning"}
            />
          </Pressable>

          {showDeveloperInfo ? (
            <View style={styles.developerDetails}>
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
            </View>
          ) : null}
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
  developerToggle: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  developerToggleCopy: {
    flex: 1,
    gap: tokens.space.xs
  },
  developerDetails: {
    gap: tokens.space.md
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
