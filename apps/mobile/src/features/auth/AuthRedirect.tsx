import { Redirect } from "expo-router";

import { AppScreen, AppText, Card, PrimaryButton } from "../../components";
import { useAuth } from "./AuthProvider";

export function AuthLoadingScreen() {
  return (
    <AppScreen centered>
      <Card elevated padding="lg">
        <AppText variant="eyebrow">PersoNewsAP</AppText>
        <AppText variant="title">Loading your session</AppText>
        <AppText color="muted" variant="body">
          Preparing your daily briefing space.
        </AppText>
      </Card>
    </AppScreen>
  );
}

export function AuthRedirect() {
  const { error, refreshAuthState, status } = useAuth();

  if (status === "loading") {
    return <AuthLoadingScreen />;
  }

  if (error?.code === "missing_supabase_config") {
    return (
      <AppScreen centered>
        <Card elevated padding="lg">
          <AppText variant="eyebrow">Configuration</AppText>
          <AppText variant="title">Supabase is not configured</AppText>
          <AppText color="muted" variant="body">
            {error.message}
          </AppText>
          {error.hint ? (
            <AppText color="muted" variant="caption">
              {error.hint}
            </AppText>
          ) : null}
          <AppText color="muted" variant="caption">
            Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo.
          </AppText>
          <PrimaryButton label="Retry" onPress={refreshAuthState} />
        </Card>
      </AppScreen>
    );
  }

  if (status === "signedOut") {
    return <Redirect href="/(auth)/login" />;
  }

  if (status === "needsOnboarding") {
    return <Redirect href="/(onboarding)/language" />;
  }

  return <Redirect href="/(tabs)/today" />;
}
