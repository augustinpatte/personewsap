import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { Animated, Pressable, StyleSheet, View } from "react-native";

import { AppText, EmptyState, PrimaryButton } from "../../../components";
import { tokens, type ColorToken } from "../../../design/tokens";
import {
  getDifficultyLabel,
  getReaderCopy,
  getTopicLabel
} from "../contentCopy";
import { useDailyDrop } from "../DailyDropContext";
import type { MiniCaseChallenge, MiniCaseOption, MiniCaseOptionOutcome } from "../contentTypes";
import { ReaderScaffold } from "./ReaderScaffold";

type Phase = "decide" | "feedback" | "debrief";

const outcomeColors: Record<
  MiniCaseOptionOutcome,
  { border: ColorToken; fill: ColorToken; ink: ColorToken }
> = {
  best: { border: "success", fill: "successSoft", ink: "success" },
  viable: { border: "warning", fill: "warningSoft", ink: "warning" },
  weak: { border: "danger", fill: "dangerSoft", ink: "danger" }
};

export function MiniCaseReader({ caseId }: { caseId: string }) {
  const router = useRouter();
  const { language, getItemById } = useDailyDrop();
  const copy = getReaderCopy(language);

  const item = getItemById(caseId);

  if (!item || item.content_type !== "mini_case") {
    return (
      <ReaderScaffold closeLabel={copy.close} onClose={() => router.back()}>
        <EmptyState
          description={
            language === "fr"
              ? "Ce cas n'est plus disponible."
              : "This case is no longer available."
          }
          title={language === "fr" ? "Introuvable" : "Not found"}
        />
      </ReaderScaffold>
    );
  }

  return <MiniCaseFlow challenge={item} key={item.id} />;
}

function MiniCaseFlow({ challenge }: { challenge: MiniCaseChallenge }) {
  const router = useRouter();
  const { language, isItemComplete, markItemsComplete } = useDailyDrop();
  const copy = getReaderCopy(language);

  const hasOptions = Boolean(challenge.options && challenge.options.length > 0);
  const [phase, setPhase] = useState<Phase>("decide");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const reveal = useRef(new Animated.Value(0)).current;

  const selectedOption =
    challenge.options?.find((option) => option.id === selectedId) ?? null;

  useEffect(() => {
    if (phase === "debrief" && !isItemComplete(challenge.id)) {
      void markItemsComplete([challenge]);
    }
  }, [challenge, isItemComplete, markItemsComplete, phase]);

  const onSelect = (option: MiniCaseOption) => {
    if (phase !== "decide") {
      return;
    }
    setSelectedId(option.id);
    setPhase("feedback");
    reveal.setValue(0);
    Animated.timing(reveal, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true
    }).start();
  };

  const onFinish = async () => {
    if (!isItemComplete(challenge.id)) {
      await markItemsComplete([challenge]);
    }
    router.back();
  };

  return (
    <ReaderScaffold
      closeLabel={copy.close}
      eyebrow={copy.caseEyebrow}
      footer={renderFooter()}
      onClose={() => router.back()}
    >
      <AppText color="muted" variant="eyebrow">
        {`${getTopicLabel(challenge.topic, language)} · ${getDifficultyLabel(
          challenge.difficulty,
          language
        )}`}
      </AppText>

      <AppText style={styles.title} variant="title">
        {challenge.title}
      </AppText>

      <View style={styles.situation}>
        <AppText color="muted" variant="eyebrow">
          {copy.context}
        </AppText>
        <AppText variant="read">{challenge.context}</AppText>
      </View>

      {challenge.constraints.length > 0 ? (
        <View style={styles.constraints}>
          <AppText color="muted" variant="eyebrow">
            {copy.constraints}
          </AppText>
          {challenge.constraints.map((constraint, index) => (
            <View key={index} style={styles.constraintRow}>
              <View style={styles.bullet} />
              <AppText color="inkSoft" style={styles.constraintText} variant="body">
                {constraint}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.question}>
        <AppText color="muted" variant="eyebrow">
          {copy.decide}
        </AppText>
        <AppText variant="subtitle">{challenge.question}</AppText>
        {phase === "decide" && hasOptions ? (
          <AppText color="muted" variant="caption">
            {copy.chooseHint}
          </AppText>
        ) : null}
      </View>

      {hasOptions ? renderOptions() : null}
      {phase === "debrief" ? renderDebrief() : null}
    </ReaderScaffold>
  );

  function renderOptions() {
    const options = challenge.options ?? [];

    return (
      <View style={styles.options}>
        {options.map((option, index) => {
          const isSelected = option.id === selectedId;
          const locked = phase !== "decide";
          const palette = outcomeColors[option.outcome];
          const showColor = locked && isSelected;

          return (
            <Pressable
              accessibilityRole="button"
              disabled={locked}
              key={option.id}
              onPress={() => onSelect(option)}
              style={({ pressed }) => [
                styles.option,
                pressed && !locked ? styles.optionPressed : null,
                showColor
                  ? {
                      backgroundColor: tokens.color[palette.fill],
                      borderColor: tokens.color[palette.border]
                    }
                  : null,
                locked && !isSelected ? styles.optionDimmed : null
              ]}
            >
              <View style={styles.optionMarker}>
                <AppText color={showColor ? palette.ink : "muted"} variant="label">
                  {String.fromCharCode(65 + index)}
                </AppText>
              </View>
              <AppText style={styles.optionLabel} variant="body">
                {option.label}
              </AppText>
            </Pressable>
          );
        })}

        {phase !== "decide" && selectedOption ? (
          <Animated.View
            style={[
              styles.feedback,
              {
                opacity: reveal,
                transform: [
                  {
                    translateY: reveal.interpolate({
                      inputRange: [0, 1],
                      outputRange: [8, 0]
                    })
                  }
                ]
              }
            ]}
          >
            <AppText color={outcomeColors[selectedOption.outcome].ink} variant="eyebrow">
              {copy[selectedOption.outcome]}
            </AppText>
            <AppText style={styles.feedbackBody} variant="read">
              {selectedOption.feedback}
            </AppText>
          </Animated.View>
        ) : null}
      </View>
    );
  }

  function renderDebrief() {
    return (
      <View style={styles.debrief}>
        <View style={styles.debriefBlock}>
          <AppText color="muted" variant="eyebrow">
            {copy.keyMoves}
          </AppText>
          {challenge.expected_reasoning.map((point, index) => (
            <View key={index} style={styles.constraintRow}>
              <View style={styles.bullet} />
              <AppText style={styles.constraintText} variant="read">
                {point}
              </AppText>
            </View>
          ))}
        </View>

        <View style={styles.debriefBlock}>
          <AppText color="muted" variant="eyebrow">
            {copy.reference}
          </AppText>
          <AppText variant="read">{challenge.sample_answer}</AppText>
        </View>
      </View>
    );
  }

  function renderFooter() {
    if (!hasOptions) {
      if (phase === "decide") {
        return <PrimaryButton label={copy.continue} onPress={() => setPhase("debrief")} />;
      }
      return <PrimaryButton label={copy.finishCase} onPress={onFinish} />;
    }

    if (phase === "decide") {
      return null;
    }

    if (phase === "feedback") {
      return <PrimaryButton label={copy.continue} onPress={() => setPhase("debrief")} />;
    }

    return <PrimaryButton label={copy.finishCase} onPress={onFinish} />;
  }
}

const styles = StyleSheet.create({
  title: {
    marginTop: tokens.space.md
  },
  situation: {
    gap: tokens.space.sm,
    marginTop: tokens.space.xl
  },
  constraints: {
    gap: tokens.space.sm,
    marginTop: tokens.space.lg
  },
  constraintRow: {
    flexDirection: "row",
    gap: tokens.space.md
  },
  bullet: {
    backgroundColor: tokens.color.mutedSoft,
    borderRadius: tokens.radius.pill,
    height: 6,
    marginTop: 9,
    width: 6
  },
  constraintText: {
    flex: 1
  },
  question: {
    borderTopColor: tokens.color.borderStrong,
    borderTopWidth: 1,
    gap: tokens.space.sm,
    marginTop: tokens.space.xl,
    paddingTop: tokens.space.xl
  },
  options: {
    gap: tokens.space.md,
    marginTop: tokens.space.lg
  },
  option: {
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: tokens.space.md,
    minHeight: 60,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md
  },
  optionPressed: {
    backgroundColor: tokens.color.surfaceMuted
  },
  optionDimmed: {
    opacity: 0.45
  },
  optionMarker: {
    alignItems: "center",
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  optionLabel: {
    color: tokens.color.ink,
    flex: 1
  },
  feedback: {
    borderLeftColor: tokens.color.borderStrong,
    borderLeftWidth: 2,
    gap: tokens.space.sm,
    marginTop: tokens.space.sm,
    paddingLeft: tokens.space.lg
  },
  feedbackBody: {
    color: tokens.color.ink
  },
  debrief: {
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    gap: tokens.space.xl,
    marginTop: tokens.space.xl,
    paddingTop: tokens.space.xl
  },
  debriefBlock: {
    gap: tokens.space.sm
  }
});
