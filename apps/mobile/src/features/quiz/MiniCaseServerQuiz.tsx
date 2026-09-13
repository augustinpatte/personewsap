import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View, type ScrollView } from "react-native";

import { AppText, EmptyState, PrimaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { getReaderCopy } from "../today/contentCopy";
import type { MiniCaseChallenge } from "../today/contentTypes";
import { useDailyDrop } from "../today/DailyDropContext";
import { ReaderScaffold } from "../today/readers";
import { QuestionCard } from "./QuestionCard";
import {
  resolveQuestionsCta,
  type ContentQuestionProgress,
  type SettledSeed
} from "./questionProgress";
import { getQuizCopy, questionsCtaLabel } from "./quizCopy";
import { formatPoints } from "./quizSession";
import { TeamBadge } from "./TeamBadge";
import type { TeamRef } from "./teamMerge";
import { useReadingQuestions } from "./useReadingQuestions";
import { questionListKey, useQuizFlow, type QuizQuestionRef } from "./useQuizFlow";

/**
 * A Mini Case, scored by the server.
 *
 * THE OPPOSITE DECISION TO THE NEWSLETTER, on purpose: the situation, the
 * challenge and the constraints stay on screen for all three questions, because
 * the case IS the material and the three questions walk through it —
 *
 *     method_framework  ->  technical_application  ->  conclusion_decision
 *
 * The reader reads the case first and starts the questions from the button,
 * which already says where they stand ("Continue questions" when Q1 and Q2 are
 * settled and Q3 is not). The first question still owed is the one scrolled
 * into view and started; settled ones are never started again. Every state
 * below the case is composed — loading, unavailable, empty, question, score.
 */
export function MiniCaseServerQuiz({
  caseIntro,
  challenge
}: {
  /** The existing CaseIntro, rendered by the caller so its markup is unchanged. */
  caseIntro: React.ReactNode;
  challenge: MiniCaseChallenge;
}) {
  const { questions, teams, progress, progressKnown, settled } = useReadingQuestions(challenge);

  // Keyed by the logical question list, so the flow always has a state per
  // question — and a language switch, which keeps the ids, keeps the flow.
  return (
    <MiniCaseServerQuizBody
      caseIntro={caseIntro}
      challenge={challenge}
      key={questionListKey(questions)}
      progress={progress}
      progressKnown={progressKnown}
      questions={questions}
      settled={settled}
      teams={teams}
    />
  );
}

function MiniCaseServerQuizBody({
  caseIntro,
  challenge,
  progress,
  progressKnown,
  questions,
  settled,
  teams
}: {
  caseIntro: React.ReactNode;
  challenge: MiniCaseChallenge;
  progress: ContentQuestionProgress;
  progressKnown: boolean;
  questions: QuizQuestionRef[];
  settled: Record<string, SettledSeed>;
  teams: TeamRef[];
}) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, isItemComplete, markItemsComplete } = useDailyDrop();
  const readerCopy = getReaderCopy(language);
  const copy = getQuizCopy(language);
  const [started, setStarted] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const questionsOffsetRef = useRef<number | null>(null);

  const quiz = useQuizFlow({
    questions,
    active: started,
    contentType: "mini_case",
    isTeam: teams.length > 0,
    settled
  });

  const state = quiz.states[quiz.currentIndex];

  // Bring the question on screen whenever a new one is displayed, with the
  // case still above it to scroll back to.
  const scrollToQuestions = useCallback(() => {
    if (!started || questionsOffsetRef.current === null) {
      return;
    }

    scrollRef.current?.scrollTo({
      y: Math.max(0, questionsOffsetRef.current - tokens.space.md),
      animated: true
    });
  }, [started]);

  useEffect(() => {
    scrollToQuestions();
  }, [quiz.currentIndex, scrollToQuestions]);

  const onFinish = async () => {
    if (!isItemComplete(challenge.id)) {
      await markItemsComplete([challenge]);
    }

    router.back();
  };

  const footer = !started ? (
    <View style={styles.footerActions}>
      {progressKnown ? (
        <AppText color="muted" variant="caption">
          {copy.questionsProgress(progress.settled, progress.total)}
        </AppText>
      ) : null}
      <PrimaryButton
        label={questionsCtaLabel(resolveQuestionsCta(progress), copy)}
        onPress={() => setStarted(true)}
      />
    </View>
  ) : quiz.isComplete ? (
    <PrimaryButton label={readerCopy.finishCase} onPress={onFinish} />
  ) : undefined;

  return (
    <ReaderScaffold
      closeLabel={readerCopy.close}
      eyebrow={readerCopy.caseEyebrow}
      footer={footer}
      iconName="check-square"
      onClose={() => router.back()}
      scrollRef={scrollRef}
    >
      {/* The case, unchanged and always visible. */}
      {caseIntro}

      <TeamBadge compact language={language} teams={teams} />

      <View
        onLayout={(event) => {
          questionsOffsetRef.current = event.nativeEvent.layout.y;
          scrollToQuestions();
        }}
        style={styles.questions}
      >
        {!started ? (
          <AppText color="muted" variant="caption">
            {copy.questionsIntro(questions.length)}
          </AppText>
        ) : questions.length === 0 ? (
          <EmptyState description={copy.emptyBody} iconName="help-circle" title={copy.emptyTitle} />
        ) : quiz.isComplete || !state ? (
          <View style={styles.complete}>
            <AppText color="muted" variant="eyebrow">
              {copy.completeTitle}
            </AppText>
            <AppText variant="subtitle">
              {copy.completeScore(
                formatPoints(quiz.scoreMilli),
                formatPoints(quiz.total * 1000)
              )}
            </AppText>
          </View>
        ) : (
          <QuestionCard
            copyLanguage={language}
            explanation={quiz.explanation}
            index={quiz.currentIndex}
            isLast={quiz.currentIndex === quiz.total - 1}
            onContinue={quiz.advance}
            onRetryStart={quiz.retryStart}
            onSelect={quiz.select}
            onSkip={quiz.skip}
            state={state}
            total={quiz.total}
          />
        )}
      </View>
    </ReaderScaffold>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    footerActions: {
      gap: tokens.space.sm
    },
    questions: {
      // A rule rather than a card: the questions are the next part of the same
      // page, not a separate surface floating over the case.
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.lg,
      marginTop: tokens.space.xl,
      paddingTop: tokens.space.xl
    },
    complete: {
      gap: tokens.space.sm
    }
  });
