import { StyleSheet, View } from "react-native";

import { AppText, PrimaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import type { ContentLanguage } from "../today/contentTypes";
import { ReaderScaffold } from "../today/readers";
import { QuestionCard } from "./QuestionCard";
import { getQuizCopy } from "./quizCopy";
import { formatPoints } from "./quizSession";
import { TeamBadge } from "./TeamBadge";
import type { TeamRef } from "./teamMerge";
import type { QuizFlowState } from "./useQuizFlow";

/**
 * The question step of a Newsletter article or a Business Story.
 *
 * THE ARTICLE IS NOT ON THIS SCREEN. That is the whole point of it being a
 * screen rather than a section appended to the reader: a question about what a
 * mechanism implies is not a reading-comprehension exercise, and leaving the
 * text visible would turn twenty seconds of judgement into twenty seconds of
 * scanning. The Mini Case is deliberately the opposite — its case stays visible,
 * because there the case IS the material and the questions walk through it.
 *
 * It reuses ReaderScaffold, so the back affordance, the safe area, the tab-bar
 * inset and the editorial chrome are the ones the rest of the app already has.
 * Nothing here introduces a second design system.
 */
export function ReadingQuizScreen({
  eyebrow,
  language,
  onClose,
  quiz,
  teams,
  title
}: {
  eyebrow: string;
  language: ContentLanguage;
  onClose: () => void;
  quiz: QuizFlowState;
  teams: TeamRef[];
  /** The headline, kept as context. The body is not. */
  title: string;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getQuizCopy(language);
  const state = quiz.states[quiz.currentIndex];

  if (quiz.isComplete || !state) {
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
