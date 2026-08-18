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
        updated: "Last updated 18 August 2026. The full policy is at personewsap /privacy.",
        back: "Back",
        sections: [
          {
            title: "Data we use",
            lines: [
              "Email is used for account sign-up, login, password reset, and account support.",
              "Profile language decides whether the app and your editions are in French or English.",
              "Newsletter and mini-case preferences decide what each edition contains.",
              "Content interactions — opened, completed, saved, rated — keep your archive and progress accurate.",
              "Mini-case answers and scores are stored so you can review a completed case, on any of your devices.",
              "Learning path: the objective and level you chose, the sessions prepared for you, and your session ratings."
            ]
          },
          {
            title: "Device and product signals",
            lines: [
              "Push tokens are stored only when notifications are on, so PersoNewsAP can send one notification per published edition — four a week, never on a quiet day.",
              "If analytics is configured for this build, the app sends limited product events such as language, topic, content type, edition date, and item ID. When it is not configured, nothing is sent.",
              "The mobile app never contains a Supabase service-role key or any server-side generation secret."
            ]
          },
          {
            title: "Your controls",
            lines: [
              "You can change language, newsletter topics, mini-case topics, notifications and content preferences from Account.",
              "You can export your account data as JSON from Account. The export reads only your own data, through authenticated row-level-secured queries.",
              "You can delete your account from Account, or from the website without installing the app. Deletion is immediate and permanent, and signs you out.",
              "Editorial content itself is shared by all readers and is not deleted; it simply stops being linked to you."
            ]
          }
        ]
      },
      fr: {
        eyebrow: "Confidentialité",
        title: "Politique de confidentialité",
        updated:
          "Dernière mise à jour le 18 août 2026. La politique complète est sur personewsap /privacy.",
        back: "Retour",
        sections: [
          {
            title: "Données utilisées",
            lines: [
              "L'e-mail sert à créer le compte, se connecter, réinitialiser le mot de passe et gérer le support.",
              "La langue du profil détermine si l'application et vos éditions sont en français ou en anglais.",
              "Les préférences newsletter et mini-cas déterminent le contenu de chaque édition.",
              "Les interactions — ouvert, terminé, enregistré, noté — gardent votre archive et votre progression exactes.",
              "Vos réponses et scores aux mini-cas sont conservés pour pouvoir revoir un cas terminé, sur chacun de vos appareils.",
              "Parcours : l'objectif et le niveau choisis, les sessions préparées pour vous et vos évaluations de session."
            ]
          },
          {
            title: "Signaux appareil et produit",
            lines: [
              "Les jetons push sont conservés uniquement lorsque les notifications sont activées, afin d'envoyer une notification par édition publiée — quatre par semaine, jamais un jour sans édition.",
              "Si l'analyse produit est configurée pour cette version, l'application envoie des événements limités : langue, thème, type de contenu, date d'édition et identifiant de contenu. Sans configuration, rien n'est envoyé.",
              "L'application mobile ne contient jamais de clé Supabase service-role ni de secret de génération côté serveur."
            ]
          },
          {
            title: "Vos contrôles",
            lines: [
              "Vous pouvez modifier la langue, les thèmes newsletter, les thèmes mini-cas, les notifications et vos préférences depuis Compte.",
              "Vous pouvez exporter les données de votre compte en JSON depuis Compte. L'export ne lit que vos propres données, via des requêtes authentifiées protégées par RLS.",
              "Vous pouvez supprimer votre compte depuis Compte, ou depuis le site sans installer l'application. La suppression est immédiate, définitive, et vous déconnecte.",
              "Le contenu éditorial est partagé par tous les lecteurs et n'est pas supprimé ; il cesse simplement d'être associé à vous."
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
