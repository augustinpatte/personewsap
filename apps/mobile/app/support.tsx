import { Linking, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { AppScreen } from "../src/components/AppScreen";
import { AppText } from "../src/components/AppText";
import { Card } from "../src/components/Card";
import { SecondaryButton } from "../src/components/SecondaryButton";
import { tokens } from "../src/design/tokens";
import { useThemedStyles } from "../src/design/theme";
import { useAuth } from "../src/features/auth";
import { localized } from "../src/lib/i18n";

const DEFAULT_SUPPORT_EMAIL = "support@personewsap.com";

export default function SupportScreen() {
  const router = useRouter();
  const { profileLanguage, user } = useAuth();
  const styles = useThemedStyles(createStyles);
  const copy = getSupportCopy(profileLanguage);
  const supportEmail =
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT_EMAIL;

  const openEmail = () => {
    const subject = encodeURIComponent(copy.emailSubject);
    const body = encodeURIComponent(`${copy.emailBody}\n\n${user?.email ?? ""}`);
    void Linking.openURL(`mailto:${supportEmail}?subject=${subject}&body=${body}`);
  };

  return (
    <AppScreen>
      <AppScreen.Header>
        <AppText variant="eyebrow">{copy.eyebrow}</AppText>
        <AppText variant="title">{copy.title}</AppText>
        <AppText color="muted" variant="body">
          {copy.description}
        </AppText>
      </AppScreen.Header>

      <AppScreen.Body>
        <Card padding="lg" style={styles.card}>
          <AppText variant="subtitle">{copy.contactTitle}</AppText>
          <View style={styles.copyBlock}>
            <AppText color="muted" variant="body">
              {copy.contactDescription}
            </AppText>
            <AppText variant="bodyStrong">{supportEmail}</AppText>
          </View>
          <SecondaryButton label={copy.emailButton} onPress={openEmail} />
        </Card>

        <SecondaryButton label={copy.back} onPress={() => router.back()} />
      </AppScreen.Body>
    </AppScreen>
  );
}

function getSupportCopy(language: string | null) {
  return localized(
    {
      en: {
        back: "Back",
        contactDescription:
          "For account access, notification issues, deletion questions, or store-review support, contact us by email.",
        contactTitle: "Contact",
        description: "A direct support path for account and privacy questions.",
        emailBody: "Hello PersoNewsAP support,",
        emailButton: "Email support",
        emailSubject: "PersoNewsAP support request",
        eyebrow: "Support",
        title: "Support"
      },
      fr: {
        back: "Retour",
        contactDescription:
          "Pour l'accès au compte, les notifications, la suppression du compte ou les questions de confidentialité, contactez-nous par e-mail.",
        contactTitle: "Contact",
        description: "Un accès direct au support pour les questions de compte et de confidentialité.",
        emailBody: "Bonjour le support PersoNewsAP,",
        emailButton: "Contacter le support",
        emailSubject: "Demande de support PersoNewsAP",
        eyebrow: "Support",
        title: "Support"
      }
    },
    language === "fr" ? "fr" : "en"
  );
}

const createStyles = () =>
  StyleSheet.create({
    card: {
      gap: tokens.space.lg
    },
    copyBlock: {
      gap: tokens.space.sm
    }
  });
