import { Redirect } from "expo-router";
import { ActivityIndicator } from "react-native";

import { AppScreen, AppText, Card, PrimaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useAuth } from "./AuthProvider";

export function AuthLoadingScreen() {
  return (
    <AppScreen centered>
      <Card elevated padding="lg">
        <AppText variant="eyebrow">PersoNewsAP</AppText>
        <AppText variant="title">Loading your session</AppText>
        <ActivityIndicator color={tokens.color.accent} />
        <AppText color="muted" variant="body">
          Checking the saved session. If the network is slow, this screen will stay calm instead of flashing the app.
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
          <AppText variant="eyebrow">Developer/Test setup</AppText>
          <AppText variant="title">Sign-in setup needed</AppText>
          <AppText color="muted" variant="body">
            {error.message}
          </AppText>
          {error.hint ? (
            <AppText color="muted" variant="caption">
              {error.hint}
            </AppText>
          ) : null}
          <AppText color="muted" variant="caption">
            Developer/Test info: add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to apps/mobile/.env, then restart Expo.
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
