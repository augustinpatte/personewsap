import { Redirect } from "expo-router";
import { ActivityIndicator } from "react-native";

import { AppScreen, AppText, Card, PrimaryButton } from "../../components";
import { useThemeColors } from "../../design/theme";
import { localized } from "../../lib/i18n";
import { getUserFacingError } from "../../lib/userFacingErrors";
import type { Language } from "../../types/domain";
import { useAuth } from "./AuthProvider";

export function AuthLoadingScreen({
  language = null
}: {
  language?: Language | null;
}) {
  const colors = useThemeColors();
  const copy = getAuthRedirectCopy(language);

  return (
    <AppScreen centered>
      <Card elevated padding="lg">
        <AppText variant="eyebrow">PersoNewsAP</AppText>
        <AppText variant="title">{copy.loadingTitle}</AppText>
        <ActivityIndicator color={colors.accent} />
        <AppText color="muted" variant="body">
          {copy.loadingDescription}
        </AppText>
      </Card>
    </AppScreen>
  );
}

export function AuthRedirect() {
  const { error, profileLanguage, refreshAuthState, status } = useAuth();
  const copy = getAuthRedirectCopy(profileLanguage);

  if (status === "loading") {
    return <AuthLoadingScreen language={profileLanguage} />;
  }

  if (error?.code === "missing_supabase_config") {
    const userFacingError = getUserFacingError(error, profileLanguage, "auth");

    return (
      <AppScreen centered>
        <Card elevated padding="lg">
          <AppText variant="eyebrow">{copy.accountEyebrow}</AppText>
          <AppText variant="title">{userFacingError.title}</AppText>
          <AppText color="muted" variant="body">
            {userFacingError.message}
          </AppText>
          <PrimaryButton label={copy.retry} onPress={refreshAuthState} />
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

function getAuthRedirectCopy(language: Language | null | undefined) {
  return localized(
    {
      en: {
        accountEyebrow: "Account",
        loadingDescription:
          "Checking the saved session. If the network is slow, this screen will stay calm instead of flashing the app.",
        loadingTitle: "Loading your session",
        retry: "Retry"
      },
      fr: {
        accountEyebrow: "Compte",
        loadingDescription:
          "Vérification de la session enregistrée. Si le réseau est lent, cet écran reste stable au lieu de faire clignoter l'app.",
        loadingTitle: "Chargement de ta session",
        retry: "Réessayer"
      }
    },
    language
  );
}
