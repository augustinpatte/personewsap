import { useState } from "react";
import { Modal, StyleSheet, View } from "react-native";

import { AppText, Card, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import type { Language } from "../../types/domain";
import { getLearningCopy } from "./learningCopy";
import { useLearningPath } from "./LearningPathContext";
import {
  localizeLearningDescription,
  localizeLearningField
} from "./learningTypes";

type LearningAccountSectionProps = {
  language: Language | null | undefined;
  onCreate: () => void;
  onOverview: () => void;
  onReplace: () => void;
};

export function LearningAccountSection({
  language,
  onCreate,
  onOverview,
  onReplace
}: LearningAccountSectionProps) {
  const styles = useThemedStyles(createStyles);
  const copy = getLearningCopy(language).account;
  const { activeDomain, activeObjective, activePath, completedSessions } = useLearningPath();
  const [replaceVisible, setReplaceVisible] = useState(false);

  return (
    <>
      <Card tone="muted">
        <View style={styles.cardBody}>
          <AppText variant="subtitle">{copy.title}</AppText>
          {activePath && activeDomain && activeObjective ? (
            <>
              <AppText color="muted" variant="body">
                {copy.description}
              </AppText>
              <View style={styles.summary}>
                <AppText variant="bodyStrong">{localizeLearningField(activeDomain, language)}</AppText>
                <AppText color="muted" variant="body">
                  {localizeLearningField(activeObjective, language)}
                </AppText>
                <AppText color="muted" variant="caption">
                  {localizeLearningDescription(activeObjective, language)}
                </AppText>
                <AppText color="accentInk" variant="label">
                  {copy.sessionsCompleted(completedSessions.length)}
                </AppText>
              </View>
              <View style={styles.actions}>
                <SecondaryButton label={copy.overview} onPress={onOverview} />
                <SecondaryButton label={copy.change} onPress={() => setReplaceVisible(true)} />
              </View>
            </>
          ) : (
            <>
              <AppText variant="bodyStrong">{copy.emptyTitle}</AppText>
              <AppText color="muted" variant="body">
                {copy.emptyBody}
              </AppText>
              <PrimaryButton label={copy.emptyTitle} onPress={onCreate} />
            </>
          )}
        </View>
      </Card>

      <Modal
        animationType="fade"
        onRequestClose={() => setReplaceVisible(false)}
        transparent
        visible={replaceVisible}
      >
        <View style={styles.modalOverlay}>
          <Card elevated padding="lg" style={styles.modalCard}>
            <AppText variant="subtitle">{copy.replaceTitle}</AppText>
            <AppText color="muted" variant="body">
              {copy.replaceBody}
            </AppText>
            <View style={styles.actions}>
              <SecondaryButton label={copy.cancel} onPress={() => setReplaceVisible(false)} />
              <PrimaryButton
                label={copy.confirm}
                onPress={() => {
                  setReplaceVisible(false);
                  onReplace();
                }}
              />
            </View>
          </Card>
        </View>
      </Modal>
    </>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    actions: {
      gap: tokens.space.sm
    },
    cardBody: {
      gap: tokens.space.md
    },
    modalCard: {
      gap: tokens.space.lg,
      maxWidth: 420,
      width: "100%"
    },
    modalOverlay: {
      alignItems: "center",
      backgroundColor: c.scrim,
      flex: 1,
      justifyContent: "center",
      padding: tokens.space.lg
    },
    summary: {
      gap: tokens.space.xs
    }
  });
