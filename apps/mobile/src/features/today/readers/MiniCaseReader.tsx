import { useEffect, useMemo, useRef, useState } from "react";
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
import type {
  ContentLanguage,
  MiniCaseChallenge,
  MiniCaseOption,
  MiniCaseOptionOutcome,
  MiniCaseQuestion,
  MiniCaseQuestionRole
} from "../contentTypes";
import { ReaderScaffold } from "./ReaderScaffold";

type Phase = "decide" | "feedback" | "debrief";
type ReaderCopy = ReturnType<typeof getReaderCopy>;

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
  const questions = challenge.questions ?? [];

  if (questions.length > 0) {
    return <MiniCaseQuizFlow challenge={challenge} questions={questions} />;
  }

  return <MiniCaseLegacyFlow challenge={challenge} />;
}

function CaseIntro({
  challenge,
  copy,
  language
}: {
  challenge: MiniCaseChallenge;
  copy: ReaderCopy;
  language: ContentLanguage;
}) {
  return (
    <>
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
    </>
  );
}

function MiniCaseQuizFlow({
  challenge,
  questions
}: {
  challenge: MiniCaseChallenge;
  questions: MiniCaseQuestion[];
}) {
  const router = useRouter();
  const { language, isItemComplete, markItemsComplete } = useDailyDrop();
  const copy = getReaderCopy(language);

  const [index, setIndex] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [showResults, setShowResults] = useState(false);
  const reveal = useRef(new Animated.Value(0)).current;

  const total = questions.length;
  const currentQuestion = questions[index];
  const selectedId = selections[currentQuestion.id] ?? null;
  const answered = selectedId !== null;
  const isLast = index >= total - 1;

  const score = useMemo(
    () =>
      questions.reduce((runningScore, question) => {
        const best = question.options.find((option) => option.outcome === "best");
        return best && selections[question.id] === best.id
          ? runningScore + 1
          : runningScore;
      }, 0),
    [questions, selections]
  );

  useEffect(() => {
    if (showResults && !isItemComplete(challenge.id)) {
      void markItemsComplete([challenge]);
    }
  }, [challenge, isItemComplete, markItemsComplete, showResults]);

  const onSelect = (option: MiniCaseOption) => {
    if (answered) {
      return;
    }
    setSelections((current) => ({ ...current, [currentQuestion.id]: option.id }));
    reveal.setValue(0);
    Animated.timing(reveal, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true
    }).start();
  };

  const onAdvance = () => {
    if (isLast) {
      setShowResults(true);
      return;
    }
    setIndex((current) => current + 1);
    reveal.setValue(0);
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
      <CaseIntro challenge={challenge} copy={copy} language={language} />
      {showResults ? renderResults() : renderQuestion()}
    </ReaderScaffold>
  );

  function renderQuestion() {
    const roleLabel = currentQuestion.role ? roleLabelFor(currentQuestion.role, copy) : null;
    const stepLabel = copy.questionStep(index + 1, total);
    const selectedOption =
      currentQuestion.options.find((option) => option.id === selectedId) ?? null;
    const isCorrect = selectedOption?.outcome === "best";
    const bestOption =
      currentQuestion.options.find((option) => option.outcome === "best") ?? null;
    const caseReasoning = challenge.expected_reasoning[0];
    const whyCorrect =
      firstNonEmpty(
        selectedOption?.feedback,
        currentQuestion.explanation,
        challenge.final_takeaway,
        caseReasoning
      ) ?? copy.feedbackFallback;
    const whyWrong = firstNonEmpty(selectedOption?.feedback);
    const whyBest =
      firstNonEmpty(
        bestOption?.feedback,
        currentQuestion.explanation,
        challenge.final_takeaway,
        caseReasoning
      ) ?? copy.feedbackFallback;

    return (
      <View style={styles.quiz}>
        <View style={styles.quizHeader}>
          <AppText color="muted" variant="eyebrow">
            {roleLabel ? `${stepLabel} · ${roleLabel}` : stepLabel}
          </AppText>
          <AppText variant="subtitle">{currentQuestion.prompt}</AppText>
        </View>

        <View style={styles.options}>
          {currentQuestion.options.map((option, optionIndex) => {
            const isSelected = option.id === selectedId;
            const isBest = option.outcome === "best";
            const showBest = answered && isBest;
            const showWrong = answered && isSelected && !isBest;

            return (
              <Pressable
                accessibilityRole="button"
                disabled={answered}
                key={option.id}
                onPress={() => onSelect(option)}
                style={({ pressed }) => [
                  styles.option,
                  pressed && !answered ? styles.optionPressed : null,
                  showBest ? styles.optionBest : null,
                  showWrong ? styles.optionWrong : null,
                  answered && !isSelected && !isBest ? styles.optionDimmed : null
                ]}
              >
                <View style={styles.optionMarker}>
                  <AppText
                    color={showBest ? "success" : showWrong ? "danger" : "muted"}
                    variant="label"
                  >
                    {String.fromCharCode(65 + optionIndex)}
                  </AppText>
                </View>
                <AppText style={styles.optionLabel} variant="body">
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        {answered && selectedOption ? (
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
            <AppText color={isCorrect ? "success" : "danger"} variant="eyebrow">
              {isCorrect ? copy.correct : copy.incorrect}
            </AppText>
            {isCorrect ? (
              <AppText style={styles.feedbackBody} variant="read">
                {whyCorrect}
              </AppText>
            ) : (
              <>
                {whyWrong ? (
                  <AppText style={styles.feedbackBody} variant="read">
                    {whyWrong}
                  </AppText>
                ) : null}
                {bestOption ? (
                  <View style={styles.correctAnswer}>
                    <AppText color="muted" variant="caption">
                      {copy.correctAnswer}
                    </AppText>
                    <AppText variant="bodyStrong">{bestOption.label}</AppText>
                    <AppText color="inkSoft" style={styles.feedbackBody} variant="read">
                      {whyBest}
                    </AppText>
                  </View>
                ) : null}
              </>
            )}
          </Animated.View>
        ) : null}
      </View>
    );
  }

  function renderResults() {
    return (
      <View style={styles.results}>
        <View style={styles.scoreBlock}>
          <AppText color="muted" variant="eyebrow">
            {copy.scoreEyebrow}
          </AppText>
          <AppText style={styles.scoreValue} variant="display">
            {copy.scoreValue(score, total)}
          </AppText>
          <AppText color="inkSoft" variant="read">
            {copy.scoreMessage(score, total)}
          </AppText>
        </View>

        {challenge.expected_reasoning.length > 0 ? (
          <View style={styles.debriefBlock}>
            <AppText color="muted" variant="eyebrow">
              {copy.keyMoves}
            </AppText>
            {challenge.expected_reasoning.map((point, pointIndex) => (
              <View key={pointIndex} style={styles.constraintRow}>
                <View style={styles.bullet} />
                <AppText style={styles.constraintText} variant="read">
                  {point}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.debriefBlock}>
          <AppText color="muted" variant="eyebrow">
            {copy.takeaway}
          </AppText>
          <AppText variant="read">
            {challenge.final_takeaway ?? challenge.sample_answer}
          </AppText>
        </View>
      </View>
    );
  }

  function renderFooter() {
    if (showResults) {
      return <PrimaryButton label={copy.finishCase} onPress={onFinish} />;
    }

    if (!answered) {
      return null;
    }

    return <PrimaryButton label={isLast ? copy.seeScore : copy.next} onPress={onAdvance} />;
  }
}

function MiniCaseLegacyFlow({ challenge }: { challenge: MiniCaseChallenge }) {
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
      <CaseIntro challenge={challenge} copy={copy} language={language} />

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

function roleLabelFor(role: MiniCaseQuestionRole, copy: ReaderCopy) {
  if (role === "method") {
    return copy.roleMethod;
  }
  if (role === "application") {
    return copy.roleApplication;
  }
  return copy.roleConclusion;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
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
  quiz: {
    borderTopColor: tokens.color.borderStrong,
    borderTopWidth: 1,
    gap: tokens.space.lg,
    marginTop: tokens.space.xl,
    paddingTop: tokens.space.xl
  },
  quizHeader: {
    gap: tokens.space.sm
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
  optionBest: {
    backgroundColor: tokens.color.successSoft,
    borderColor: tokens.color.success
  },
  optionWrong: {
    backgroundColor: tokens.color.dangerSoft,
    borderColor: tokens.color.danger
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
  correctAnswer: {
    gap: tokens.space.xs,
    marginTop: tokens.space.xs
  },
  results: {
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    gap: tokens.space.xl,
    marginTop: tokens.space.xl,
    paddingTop: tokens.space.xl
  },
  scoreBlock: {
    alignItems: "flex-start",
    gap: tokens.space.sm
  },
  scoreValue: {
    marginTop: tokens.space.xs
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
