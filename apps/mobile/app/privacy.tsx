import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";

import { AppScreen } from "../src/components/AppScreen";
import { AppText } from "../src/components/AppText";
import { Card } from "../src/components/Card";
import { SecondaryButton } from "../src/components/SecondaryButton";
import { tokens } from "../src/design/tokens";
import { useThemedStyles, type ThemeColors } from "../src/design/theme";
import { useAuth } from "../src/features/auth";
import { localized } from "../src/lib/i18n";

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const { profileLanguage } = useAuth();
  const styles = useThemedStyles(createStyles);
  const copy = getPrivacyCopy(profileLanguage);

  return (
    <AppScreen>
      <AppScreen.Header>
        <AppText variant="eyebrow">{copy.eyebrow}</AppText>
        <AppText variant="title">{copy.title}</AppText>
        <AppText color="muted" variant="body">
          {copy.updated}
        </AppText>
      </AppScreen.Header>

      <AppScreen.Body>
        {copy.sections.map((section) => (
          <Card key={section.title} padding="lg" style={styles.section}>
            <AppText variant="subtitle">{section.title}</AppText>
            {section.lines.map((line) => (
              <View key={line} style={styles.line}>
                <View style={styles.dot} />
                <AppText color="muted" style={styles.lineText} variant="body">
                  {line}
                </AppText>
              </View>
            ))}
          </Card>
        ))}

        <SecondaryButton label={copy.back} onPress={() => router.back()} />
      </AppScreen.Body>
    </AppScreen>
  );
}

function getPrivacyCopy(language: string | null) {
  return localized(
    {
      en: {
        eyebrow: "Privacy",
        title: "Privacy Policy",
        updated: "Launch-ready summary for PersoNewsAP mobile beta. Last updated: May 22, 2026.",
        back: "Back",
        sections: [
          {
            title: "Data we use",
            lines: [
              "Email is used for account sign-up, login, password reset, and account support.",
              "Profile language is used to show the app and daily drop in French or English.",
              "Newsletter preferences and mini-case preferences are used to assign your daily learning drop.",
              "Content interactions such as saved, completed, viewed, shared, feedback, and ratings help keep your Library and progress useful.",
              "Mini-case responses, feedback, and scores are stored so you can review your learning history."
            ]
          },
          {
            title: "Device and product signals",
            lines: [
              "Push tokens are stored only when notifications are enabled, so PersoNewsAP can send daily reminders.",
              "If analytics is configured, the app sends limited product events such as language, topic, content type, drop date, and item ID. These events are used to improve reliability and product quality.",
              "The mobile app never contains a Supabase service-role key or server-side generation secret."
            ]
          },
          {
            title: "Your controls",
            lines: [
              "You can update language, newsletter topics, mini-case topics, notifications, and content preferences from Account.",
              "You can export your account data as JSON from Account. The export uses only authenticated, row-level-secured reads for your own data.",
              "You can request account deletion from Account. Deletion requires a secure backend endpoint; if it is unavailable in a test build, contact the PersoNewsAP operator through the official TestFlight or App Store support channel."
            ]
          }
        ]
      },
      fr: {
        eyebrow: "Confidentialité",
        title: "Politique de confidentialité",
        updated:
          "Résumé pour la bêta mobile PersoNewsAP. Dernière mise à jour : 22 mai 2026.",
        back: "Retour",
        sections: [
          {
            title: "Données utilisées",
            lines: [
              "L'email sert à créer le compte, se connecter, réinitialiser le mot de passe et gérer le support compte.",
              "La langue du profil sert à afficher l'app et la mise à jour quotidienne en français ou en anglais.",
              "Les préférences newsletter et mini-cas servent à assigner ta mise à jour d'apprentissage quotidienne.",
              "Les interactions de contenu comme enregistré, terminé, vu, partagé, retours et notes gardent ta Bibliothèque et ta progression utiles.",
              "Les réponses aux mini-cas, les retours et les résultats sont stockés pour revoir ton historique d'apprentissage."
            ]
          },
          {
            title: "Signaux appareil et produit",
            lines: [
              "Les jetons push sont stockés seulement quand les notifications sont activées, afin d'envoyer les rappels quotidiens.",
              "Si l'analyse produit est configurée, l'app envoie des événements limités comme la langue, le sujet, le type de contenu, la date de la mise à jour et l'identifiant de l'élément. Ces événements servent à améliorer la fiabilité et la qualité produit.",
              "L'app mobile ne contient jamais de clé Supabase service-role ni de secret de génération côté serveur."
            ]
          },
          {
            title: "Tes contrôles",
            lines: [
              "Tu peux modifier la langue, les topics newsletter, les topics mini-cas, les notifications et les préférences depuis Compte.",
              "Tu peux exporter les données de ton compte en JSON depuis Compte. L'export utilise seulement des lectures authentifiées protégées par RLS sur tes propres données.",
              "Tu peux demander la suppression du compte depuis Compte. La suppression exige un service sécurisé côté serveur ; s'il est indisponible dans une version test, contacte l'opérateur PersoNewsAP via le canal de support officiel TestFlight ou App Store."
            ]
          }
        ]
      }
    },
    language === "fr" ? "fr" : "en"
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    section: {
      gap: tokens.space.md
    },
    line: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: tokens.space.sm
    },
    dot: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: 6,
      marginTop: 8,
      width: 6
    },
    lineText: {
      flex: 1
    }
  });
