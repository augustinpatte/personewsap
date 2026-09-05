import { Redirect } from "expo-router";

import { AppScreen, AppText, Card, PrimaryButton } from "../../components";
import { localized } from "../../lib/i18n";
import { useBootLanguage } from "../../lib/useBootLanguage";
import { getUserFacingError } from "../../lib/userFacingErrors";
import type { Language } from "../../types/domain";
import { AppLaunchScreen } from "./AppLaunchScreen";
import { useAuth } from "./AuthProvider";

export function AuthRedirect() {
  const { error, profileLanguage, refreshAuthState, status } = useAuth();
  // The config error below is the one screen here that has real sentences on
  // it, and it is reached precisely when no profile could be loaded. The last
  // language this device saw is the only answer available, and it is a far
  // better one than defaulting to English.
  const bootLanguage = useBootLanguage(profileLanguage);
  const copy = getAuthRedirectCopy(bootLanguage);

  if (status === "loading") {
    return <AppLaunchScreen language={profileLanguage} />;
  }

  if (error?.code === "missing_supabase_config") {
    const userFacingError = getUserFacingError(error, bootLanguage, "auth");

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

  return <Redirect href="/(tabs)/newsletter" />;
}

function getAuthRedirectCopy(language: Language | null | undefined) {
  return localized(
    {
      en: {
        accountEyebrow: "Account",
        retry: "Retry"
      },
      fr: {
        accountEyebrow: "Compte",
        retry: "Réessayer"
      }
    },
    language
  );
}
