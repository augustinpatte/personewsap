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
import { readItemQuestions } from "./itemQuestions";
import { getQuizCopy } from "./quizCopy";
import { formatPoints } from "./quizSession";
import { TeamBadge } from "./TeamBadge";
import type { TeamRef } from "./teamMerge";
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
 * The reader reads the case first and starts the questions with "Go to
 * questions". The first question's twenty seconds therefore start when it is
 * scrolled into view, never while it sits below the fold of a case still being
 * read. Every state below the case is composed — loading, unavailable, empty,
 * question, score — never an empty region.
 */
export function MiniCaseServerQuiz({
  caseIntro,
  challenge
}: {
  /** The existing CaseIntro, rendered by the caller so its markup is unchanged. */
  caseIntro: React.ReactNode;
  challenge: MiniCaseChallenge;
}) {
  const { questions, teams } = readItemQuestions(challenge);

  // Keyed by the logical question list, so the flow always has a state per
  // question — and a language switch, which keeps the ids, keeps the flow.
  return (
    <MiniCaseServerQuizBody
      caseIntro={caseIntro}
      challenge={challenge}
      key={questionListKey(questions)}
      questions={questions}
      teams={teams}
    />
  );
}

function MiniCaseServerQuizBody({
  caseIntro,
  challenge,
  questions,
  teams
}: {
  caseIntro: React.ReactNode;
  challenge: MiniCaseChallenge;
  questions: QuizQuestionRef[];
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
    isTeam: teams.length > 0
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
    <PrimaryButton label={copy.goToQuestions} onPress={() => setStarted(true)} />
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
            feedback={quiz.feedback}
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
