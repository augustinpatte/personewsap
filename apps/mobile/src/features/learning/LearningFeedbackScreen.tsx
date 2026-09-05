import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  AppScreen,
  AppText,
  Card,
  IconBadge,
  PrimaryButton
} from "../../components";
import { usePressedSurfaceStyle } from "../../design/usePressedSurfaceStyle";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import type { Language } from "../../types/domain";
import { sessionCompleted } from "../../lib/haptics";
import { resolveLearningFeedbackSubmitDecision } from "./learningFeedbackUi";
import { getLearningCopy } from "./learningCopy";
import { useLearningPath } from "./LearningPathContext";
import type { LearningFeedbackRatings } from "./learningTypes";

const numericLabels = ["1", "2", "3", "4", "5"];

export function LearningFeedbackScreen({ language }: { language: Language | null | undefined }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const sessionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { getSessionById, submitFeedback } = useLearningPath();
  const styles = useThemedStyles(createStyles);
  const session = sessionId ? getSessionById(sessionId) : undefined;
  const sessionLanguage = session?.language ?? language ?? "en";
  const copy = getLearningCopy(sessionLanguage).feedback;
  const [ratings, setRatings] = useState<LearningFeedbackRatings>({
    comprehension: null,
    explainability: null,
    interest: null,
    difficulty: null
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const allAnswered = useMemo(
    () =>
      ratings.comprehension !== null &&
      ratings.explainability !== null &&
      ratings.interest !== null &&
      ratings.difficulty !== null,
    [ratings]
  );

  const setRating = (key: keyof LearningFeedbackRatings, value: number) => {
    setRatings((current) => ({ ...current, [key]: value }));
    setErrorMessage(null);
    setSyncMessage(null);
  };

  const submit = async () => {
    if (
      !sessionId ||
      ratings.comprehension === null ||
      ratings.explainability === null ||
      ratings.interest === null ||
      ratings.difficulty === null
    ) {
      setErrorMessage(copy.required);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    const result = await submitFeedback(sessionId, {
      comprehension: ratings.comprehension,
      explainability: ratings.explainability,
      interest: ratings.interest,
      difficulty: ratings.difficulty
    });

    setSubmitting(false);

    const decision = resolveLearningFeedbackSubmitDecision(result);

    if (decision === "error") {
      setErrorMessage(copy.error);
      return;
    }

    if (decision === "syncPending") {
      // Recorded locally but not yet synced: the session is not finished, so
      // this is not the moment to congratulate anyone.
      setSyncMessage(copy.syncPending);
      return;
    }

    // The session is genuinely complete: an explicit submission the server
    // accepted. Fired here, on the causal event, rather than after the
    // navigation below.
    sessionCompleted();
    router.replace("/(tabs)/path");
  };

  return (
    <AppScreen contentStyle={styles.screen}>
      <View style={styles.header}>
        <IconBadge name="check-circle" tone="accent" />
        <AppText variant="eyebrow">{copy.eyebrow}</AppText>
        <AppText variant="title">{copy.title}</AppText>
        <AppText color="muted" variant="body">
          {copy.subtitle}
        </AppText>
      </View>

      <RatingGroup
        label={copy.comprehension}
        onSelect={(value) => setRating("comprehension", value)}
        question={copy.comprehensionQuestion}
        selectedValue={ratings.comprehension}
      />
      <RatingGroup
        label={copy.explainability}
        onSelect={(value) => setRating("explainability", value)}
        question={copy.explainabilityQuestion}
        selectedValue={ratings.explainability}
      />
      <RatingGroup
        label={copy.interest}
        onSelect={(value) => setRating("interest", value)}
        question={copy.interestQuestion}
        selectedValue={ratings.interest}
      />
      <RatingGroup
        labels={copy.difficultyLabels}
        label={copy.difficulty}
        onSelect={(value) => setRating("difficulty", value)}
        question={copy.difficultyQuestion}
        selectedValue={ratings.difficulty}
      />

      {errorMessage ? (
        <AppText color="danger" variant="body">
          {errorMessage}
        </AppText>
      ) : syncMessage ? (
        <AppText color="success" variant="body">
          {syncMessage}
        </AppText>
      ) : !allAnswered ? (
        <AppText color="muted" variant="caption">
          {copy.required}
        </AppText>
      ) : null}

      <PrimaryButton
        disabled={(!allAnswered && !syncMessage) || submitting}
        label={syncMessage ? copy.backToday : submitting ? copy.submitting : copy.submit}
        loading={submitting}
        onPress={syncMessage ? () => router.replace("/(tabs)/path") : submit}
      />
    </AppScreen>
  );
}

function RatingGroup({
  label,
  labels = numericLabels,
  onSelect,
  question,
  selectedValue
}: {
  label: string;
  labels?: string[];
  onSelect: (value: number) => void;
  question: string;
  selectedValue: number | null;
}) {
  const styles = useThemedStyles(createStyles);
  const pressedSurface = usePressedSurfaceStyle();

  return (
    <Card padding="lg">
      <View style={styles.ratingHeader}>
        <AppText variant="subtitle">{label}</AppText>
        <AppText color="muted" variant="body">
          {question}
        </AppText>
      </View>
      <View style={styles.ratingOptions}>
        {[1, 2, 3, 4, 5].map((value) => {
          const selected = selectedValue === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected }}
              key={value}
              onPress={() => onSelect(value)}
              style={({ pressed }) => [
                styles.ratingButton,
                selected ? styles.ratingSelected : null,
                pressed ? pressedSurface : null
              ]}
            >
              <AppText
                align="center"
                color={selected ? "onAccent" : "ink"}
                style={styles.ratingText}
                variant="label"
              >
                {labels[value - 1]}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    header: {
      gap: tokens.space.sm
    },
    ratingButton: {
      alignItems: "center",
      borderColor: c.borderStrong,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      flexGrow: 1,
      justifyContent: "center",
      minHeight: 48,
      minWidth: 52,
      paddingHorizontal: tokens.space.sm,
      paddingVertical: tokens.space.sm
    },
    ratingHeader: {
      gap: tokens.space.xs
    },
    ratingOptions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.space.sm
    },
    ratingSelected: {
      backgroundColor: c.accent,
      borderColor: c.accent
    },
    ratingText: {
      flexShrink: 1
    },
    screen: {
      gap: tokens.space.lg,
      paddingBottom: tokens.space.xxl
    }
  });
