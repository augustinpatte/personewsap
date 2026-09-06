import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText, PrimaryButton } from "../../components";
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
import { useQuizFlow } from "./useQuizFlow";

/**
 * A Mini Case, scored by the server.
 *
 * THE OPPOSITE DECISION TO THE NEWSLETTER, on purpose. A newsletter question
 * hides the article, because a question about what a mechanism implies is not a
 * reading-comprehension test and leaving the text up turns judgement into
 * scanning. A Mini Case question does the reverse: the situation, the challenge
 * and the constraints stay on screen for all three questions, because the case
 * IS the material and the three questions walk through it —
 *
 *     method_framework  ->  technical_application  ->  conclusion_decision
 *
 * A reader who cannot re-read the constraint while choosing how to apply it is
 * being tested on memory instead of on reasoning, which is not what this
 * exercise is for.
 *
 * This component is ADDITIVE. It renders only for a case whose options carry
 * real 0/300/600/1000 tiers and which has logical questions to score against;
 * every legacy case keeps the existing self-marked reader untouched. That is
 * why nothing in `MiniCaseReader`'s three existing flows changes.
 */
export function MiniCaseServerQuiz({
  caseIntro,
  challenge
}: {
  /** The existing CaseIntro, rendered by the caller so its markup is unchanged. */
  caseIntro: React.ReactNode;
  challenge: MiniCaseChallenge;
}) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, isItemComplete, markItemsComplete } = useDailyDrop();
  const readerCopy = getReaderCopy(language);
  const copy = getQuizCopy(language);
  const { questions, teams } = readItemQuestions(challenge);

  const quiz = useQuizFlow({
    questions,
    // A Mini Case has no "read the article first" step — opening the case IS
    // arriving at question 1, and the case stays visible above it.
    active: true,
    contentType: "mini_case",
    isTeam: teams.length > 0
  });

  const state = quiz.states[quiz.currentIndex];

  const onFinish = async () => {
    if (!isItemComplete(challenge.id)) {
      await markItemsComplete([challenge]);
    }

    router.back();
  };

  return (
    <ReaderScaffold
      closeLabel={readerCopy.close}
      eyebrow={readerCopy.caseEyebrow}
      iconName="check-square"
      footer={
        quiz.isComplete ? (
          <PrimaryButton label={readerCopy.finishCase} onPress={onFinish} />
        ) : undefined
      }
      onClose={() => router.back()}
    >
      {/* The case, unchanged and always visible. */}
      {caseIntro}

      <TeamBadge compact language={language} teams={teams} />

      <View style={styles.questions}>
        {quiz.isComplete || !state ? (
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
