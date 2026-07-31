import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { AppScreen, AppText, Card, PrimaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import type { Language } from "../../types/domain";
import { getLearningCopy } from "./learningCopy";
import { useLearningPath } from "./LearningPathContext";
import type { LearningFeedbackRatings } from "./learningTypes";

const numericLabels = ["1", "2", "3", "4", "5"];

export function LearningFeedbackScreen({ language }: { language: Language | null | undefined }) {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const sessionId = Array.isArray(params.id) ? params.id[0] : params.id;
  const { submitFeedback } = useLearningPath();
  const styles = useThemedStyles(createStyles);
  const copy = getLearningCopy(language).feedback;
  const [ratings, setRatings] = useState<LearningFeedbackRatings>({
    comprehension: null,
    explainability: null,
    interest: null,
    difficulty: null
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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

    if (!result.ok) {
      setErrorMessage(copy.error);
      return;
    }

    router.replace("/(tabs)/today");
  };

  return (
    <AppScreen contentStyle={styles.screen}>
      <View style={styles.header}>
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
      ) : !allAnswered ? (
        <AppText color="muted" variant="caption">
          {copy.required}
        </AppText>
      ) : null}

      <PrimaryButton
        disabled={!allAnswered || submitting}
        label={submitting ? copy.submitting : copy.submit}
        loading={submitting}
        onPress={submit}
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
                pressed ? styles.pressed : null
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
    pressed: {
      opacity: 0.72
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
