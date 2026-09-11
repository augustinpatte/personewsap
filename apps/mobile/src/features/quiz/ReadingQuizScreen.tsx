import { StyleSheet, View } from "react-native";

import { AppText, EmptyState, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import type { AnalyticsContentType } from "../../lib/analytics";
import type { ContentLanguage } from "../today/contentTypes";
import { ReaderScaffold } from "../today/readers";
import { QuestionCard } from "./QuestionCard";
import { getQuizCopy } from "./quizCopy";
import { formatPoints } from "./quizSession";
import { TeamBadge } from "./TeamBadge";
import type { TeamRef } from "./teamMerge";
import { useQuizFlow, type QuizQuestionRef } from "./useQuizFlow";

/**
 * The question step of a Newsletter article or a Business Story.
 *
 * THE ARTICLE IS NOT ON THIS SCREEN. A question about what a mechanism implies
 * is not a reading-comprehension exercise, and leaving the text visible would
 * turn twenty seconds of judgement into twenty seconds of scanning.
 *
 * It owns the quiz flow, so the flow is created only when the questions are on
 * screen (nothing starts behind the article) and — mounted with
 * `key={questionListKey(questions)}` by the reader — always with a state per
 * question.
 *
 * Every state is a composed page on the reader's own surface: LOADING is a
 * question-shaped skeleton, ERROR says "Questions unavailable" with Retry and a
 * way back to the reading, EMPTY says so explicitly, READY is the question, and
 * the end is the score. There is no branch that renders an empty page.
 */
export function ReadingQuizScreen({
  contentType,
  eyebrow,
  isTeam,
  language,
  onBackToContent,
  onClose,
  questions,
  teams,
  title
}: {
  contentType: AnalyticsContentType;
  eyebrow: string;
  isTeam: boolean;
  language: ContentLanguage;
  onBackToContent: () => void;
  onClose: () => void;
  questions: QuizQuestionRef[];
  teams: TeamRef[];
  /** The headline, kept as context. The body is not. */
  title: string;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getQuizCopy(language);
  const quiz = useQuizFlow({ questions, active: true, contentType, isTeam });
  const state = quiz.states[quiz.currentIndex];

  if (questions.length === 0) {
    return (
      <ReaderScaffold
        closeLabel={copy.backToContent}
        eyebrow={eyebrow}
        footer={<PrimaryButton label={copy.backToContent} onPress={onBackToContent} />}
        onClose={onBackToContent}
      >
        <EmptyState description={copy.emptyBody} iconName="help-circle" title={copy.emptyTitle} />
      </ReaderScaffold>
    );
  }

  if (quiz.isComplete) {
    return (
      <ReaderScaffold
        closeLabel={copy.finish}
        eyebrow={eyebrow}
        footer={<PrimaryButton label={copy.finish} onPress={onClose} />}
        onClose={onClose}
      >
        <View style={styles.complete}>
          <AppText color="muted" variant="eyebrow">
            {copy.completeTitle}
          </AppText>
          <AppText variant="title">
            {copy.completeScore(
              formatPoints(quiz.scoreMilli),
              formatPoints(quiz.total * 1000)
            )}
          </AppText>
          <AppText color="muted" numberOfLines={2} variant="caption">
            {title}
          </AppText>
          <TeamBadge language={language} teams={teams} />
        </View>
      </ReaderScaffold>
    );
  }

  return (
    <ReaderScaffold closeLabel={copy.finish} eyebrow={eyebrow} onClose={onClose}>
      <View style={styles.header}>
        {/* The headline stays as an anchor — the reader has to know which
            article they are being asked about — and the body does not. */}
        <AppText color="muted" numberOfLines={2} variant="caption">
          {title}
        </AppText>
        <TeamBadge compact language={language} teams={teams} />
      </View>

      {state ? (
        <QuestionCard
          copyLanguage={language}
          feedback={quiz.feedback}
          index={quiz.currentIndex}
          isLast={quiz.currentIndex === quiz.total - 1}
          onBackToContent={onBackToContent}
          onContinue={quiz.advance}
          onRetryStart={quiz.retryStart}
          onSelect={quiz.select}
          onSkip={quiz.skip}
          state={state}
          total={quiz.total}
        />
      ) : (
        <View style={styles.complete}>
          <AppText variant="subtitle">{copy.startFailedTitle}</AppText>
          <SecondaryButton label={copy.backToContent} onPress={onBackToContent} />
        </View>
      )}
    </ReaderScaffold>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    header: {
      borderBottomColor: c.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      gap: tokens.space.sm,
      marginBottom: tokens.space.xl,
      paddingBottom: tokens.space.md
    },
    complete: {
      gap: tokens.space.md,
      paddingTop: tokens.space.xl
    }
  });
