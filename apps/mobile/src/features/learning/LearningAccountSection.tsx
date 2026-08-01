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
  const {
    activePath,
    displayDomain,
    displayObjective,
    displayPath,
    completedSessions,
    disableLearningPath,
    sessions,
    learningPathEnabled
  } = useLearningPath();
  const [replaceVisible, setReplaceVisible] = useState(false);
  const [disableVisible, setDisableVisible] = useState(false);
  const startedCount = sessions.filter((session) => session.started_at || session.completed_at).length;
  const feedbackCount = completedSessions.length;

  return (
    <>
      <Card tone="muted">
        <View style={styles.cardBody}>
          <AppText variant="subtitle">{copy.title}</AppText>
          {displayPath && displayDomain && displayObjective ? (
            <>
              <AppText color="muted" variant="body">
                {activePath ? copy.description : copy.completedDescription}
              </AppText>
              <View style={styles.summary}>
                <AppText variant="bodyStrong">{localizeLearningField(displayDomain, language)}</AppText>
                <AppText color="muted" variant="body">
                  {localizeLearningField(displayObjective, language)}
                </AppText>
                <AppText color="muted" variant="caption">
                  {localizeLearningDescription(displayObjective, language)}
                </AppText>
                <AppText color="accentInk" variant="label">
                  {copy.sessionsStarted(startedCount)}
                </AppText>
                <AppText color="accentInk" variant="label">
                  {copy.feedbackSent(feedbackCount)}
                </AppText>
              </View>
              <View style={styles.actions}>
                <SecondaryButton label={copy.overview} onPress={onOverview} />
                <SecondaryButton label={activePath ? copy.change : copy.newPath} onPress={() => setReplaceVisible(true)} />
                {activePath ? (
                  <SecondaryButton label={copy.disable} onPress={() => setDisableVisible(true)} />
                ) : null}
              </View>
            </>
          ) : (
            <>
              <AppText variant="bodyStrong">
                {learningPathEnabled ? copy.emptyTitle : copy.disabledTitle}
              </AppText>
              <AppText color="muted" variant="body">
                {learningPathEnabled ? copy.emptyBody : copy.disabledBody}
              </AppText>
              <PrimaryButton
                label={learningPathEnabled ? copy.emptyTitle : copy.enable}
                onPress={onCreate}
              />
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

      <Modal
        animationType="fade"
        onRequestClose={() => setDisableVisible(false)}
        transparent
        visible={disableVisible}
      >
        <View style={styles.modalOverlay}>
          <Card elevated padding="lg" style={styles.modalCard}>
            <AppText variant="subtitle">{copy.disableTitle}</AppText>
            <AppText color="muted" variant="body">
              {copy.disableBody}
            </AppText>
            <View style={styles.actions}>
              <SecondaryButton label={copy.cancel} onPress={() => setDisableVisible(false)} />
              <PrimaryButton
                label={copy.disableConfirm}
                onPress={() => {
                  setDisableVisible(false);
                  void disableLearningPath();
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
