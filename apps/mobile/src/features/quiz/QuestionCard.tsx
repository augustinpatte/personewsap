import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText, ContentReveal, PrimaryButton, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useReducedMotion } from "../../design/useReducedMotion";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { usePressedSurfaceStyle } from "../../design/usePressedSurfaceStyle";
import { answerCorrect, answerIncorrect } from "../../lib/haptics";
import type { ContentLanguage } from "../today/contentTypes";
import { describeOptionForAccessibility, getQuizCopy } from "./quizCopy";
import {
  formatPoints,
  remainingSeconds,
  type QuestionState,
  type QuizOption
} from "./quizSession";

/**
 * One question, wherever it is asked.
 *
 * Used by the full-screen Newsletter and Business Story flow and inline inside
 * the Mini Case reader, because the question itself behaves identically in both
 * — only what surrounds it differs. That is also why this component renders no
 * scaffold, no safe area and no scroll view: the two hosts own their own chrome,
 * and the Mini Case's has to keep the case visible above it.
 *
 * The timer here is a RENDERING of a deadline Postgres set. It counts down from
 * `remainingSeconds(state, now)` and has no authority: if the app is suspended
 * and resumes past the deadline, the next tick settles the question at zero
 * because the deadline says so, not because a local counter reached zero.
 */

const TICK_INTERVAL_MS = 250;

export function QuestionCard({
  copyLanguage,
  state,
  index,
  total,
  onSelect,
  onSkip,
  onContinue,
  onRetryStart,
  feedback,
  isLast
}: {
  copyLanguage: ContentLanguage;
  state: QuestionState;
  /** 0-based. */
  index: number;
  total: number;
  onSelect: (optionId: string) => void;
  onSkip: () => void;
  onContinue: () => void;
  onRetryStart: () => void;
  /** Released by the server only after the answer is in. */
  feedback?: string | null;
  isLast: boolean;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getQuizCopy(copyLanguage);
  const [now, setNow] = useState(() => Date.now());

  const isTiming = state.status === "answering" || state.status === "submitting";

  // One interval, only while a deadline is actually running. A question that is
  // idle, answered or expired has nothing to count, so nothing ticks.
  useEffect(() => {
    if (!isTiming) {
      return;
    }

    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isTiming, state.status]);

  if (state.status === "start_failed") {
    return (
      <View style={styles.question}>
        <AppText variant="subtitle">{copy.startFailedTitle}</AppText>
        <AppText color="muted" variant="body">
          {copy.startFailedBody}
        </AppText>
        <PrimaryButton label={copy.retry} onPress={onRetryStart} />
      </View>
    );
  }

  if (state.status === "idle" || state.status === "starting") {
    // Deliberately no timer and no options: the question has not started, so
    // there is nothing to count down and nothing to answer.
    return (
      <View style={styles.question}>
        <AppText color="muted" variant="caption">
          {copy.progress(index + 1, total)}
        </AppText>
      </View>
    );
  }

  const seconds = remainingSeconds(state, now);
  const secondsLeft = seconds === null ? null : Math.ceil(seconds);
  const revealed = state.status === "answered" || state.status === "expired";
  const selectedOptionId = state.status === "answered" ? state.selectedOptionId : null;

  return (
    <View style={styles.question}>
      <View style={styles.meta}>
        <AppText color="muted" variant="eyebrow">
          {copy.progress(index + 1, total)}
        </AppText>
        {isTiming && secondsLeft !== null ? (
          <QuestionTimer copyLanguage={copyLanguage} secondsLeft={secondsLeft} />
        ) : null}
      </View>

      <AppText style={styles.prompt} variant="subtitle">
        {state.prompt}
      </AppText>

      <View accessibilityRole="radiogroup" style={styles.options}>
        {state.options.map((option, optionIndex) => (
          <OptionRow
            copyLanguage={copyLanguage}
            index={optionIndex}
            key={option.optionId}
            locked={state.status !== "answering"}
            onSelect={() => onSelect(option.optionId)}
            option={option}
            revealed={revealed}
            selected={selectedOptionId === option.optionId}
            total={state.options.length}
          />
        ))}
      </View>

      {state.status === "answering" ? (
        <SecondaryButton
          accessibilityLabel={`${copy.skip}. ${copy.skipHint}`}
          label={copy.skip}
          onPress={onSkip}
          style={styles.skip}
        />
      ) : null}

      {state.status === "submitting" ? (
        <AppText color="muted" variant="caption">
          {copy.locked}
        </AppText>
      ) : null}

      {revealed ? (
        <Outcome
          copyLanguage={copyLanguage}
          feedback={feedback}
          isLast={isLast}
          onContinue={onContinue}
          state={state}
        />
      ) : null}
    </View>
  );
}

/**
 * The countdown.
 *
 * Two things carry the time, not one: the number and — under five seconds — a
 * sentence. A reader using VoiceOver, or one who simply is not watching a small
 * digit, must still be told the question is about to close (§15).
 */
function QuestionTimer({
  copyLanguage,
  secondsLeft
}: {
  copyLanguage: ContentLanguage;
  secondsLeft: number;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getQuizCopy(copyLanguage);
  const urgent = secondsLeft <= 5;

  return (
    <View style={styles.timer}>
      <AppText
        accessibilityLabel={
          urgent ? `${copy.secondsLeft(secondsLeft)}. ${copy.timeRunningOut}` : copy.secondsLeft(secondsLeft)
        }
        // aria-live equivalent: the count is announced as it changes rather than
        // only when the reader lands on it.
        accessibilityLiveRegion={urgent ? "polite" : "none"}
        color={urgent ? "warning" : "muted"}
        variant="caption"
      >
        {copy.secondsLeft(secondsLeft)}
      </AppText>
    </View>
  );
}

function OptionRow({
  copyLanguage,
  index,
  locked,
  onSelect,
  option,
  revealed,
  selected,
  total
}: {
  copyLanguage: ContentLanguage;
  index: number;
  locked: boolean;
  onSelect: () => void;
  option: QuizOption;
  revealed: boolean;
  selected: boolean;
  total: number;
}) {
  const styles = useThemedStyles(createStyles);
  const pressedSurface = usePressedSurfaceStyle();
  const copy = getQuizCopy(copyLanguage);

  return (
    <Pressable
      accessibilityLabel={describeOptionForAccessibility({
        copy,
        index,
        label: option.label,
        revealed,
        selected,
        total
      })}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: locked, selected }}
      disabled={locked}
      onPress={onSelect}
      style={({ pressed }) => [
        styles.option,
        selected ? styles.optionSelected : null,
        pressed && !locked ? pressedSurface : null
      ]}
    >
      <AppText style={styles.optionText} variant="body">
        {option.label}
      </AppText>
    </Pressable>
  );
}

/**
 * What the reader is told once the answer is in.
 *
 * Score, then explanation, then Continue — and untimed. The twenty seconds
 * covered the decision; there is no speed bonus, so nothing is gained by
 * hurrying through the part that teaches.
 */
function Outcome({
  copyLanguage,
  feedback,
  isLast,
  onContinue,
  state
}: {
  copyLanguage: ContentLanguage;
  feedback?: string | null;
  isLast: boolean;
  onContinue: () => void;
  state: Extract<QuestionState, { status: "answered" | "expired" }>;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getQuizCopy(copyLanguage);
  const reduceMotion = useReducedMotion();
  const firedRef = useRef(false);

  const expired = state.status === "expired" || (state.status === "answered" && state.expired);
  const skipped = state.status === "answered" && state.skipped;
  const scoreMilli = state.status === "answered" ? state.scoreMilli : 0;

  // The one haptic a question fires: the outcome, once, on the frame it is
  // revealed. A timeout is silent — nothing was decided.
  useEffect(() => {
    if (firedRef.current || expired) {
      return;
    }

    firedRef.current = true;

    if (scoreMilli >= 600) {
      answerCorrect();
    } else {
      answerIncorrect();
    }
  }, [expired, scoreMilli]);

  const title = expired ? copy.expiredTitle : skipped ? copy.skippedTitle : null;
  const body = expired ? copy.expiredBody : skipped ? copy.skippedBody : null;

  const content = (
    <View style={styles.outcome}>
      <View style={styles.outcomeHead}>
        <AppText color="accentInk" variant="eyebrow">
          {copy.points(formatPoints(scoreMilli))}
        </AppText>
        {title ? (
          <AppText color="muted" variant="caption">
            {title}
          </AppText>
        ) : null}
      </View>

      {body ? (
        <AppText color="inkSoft" variant="body">
          {body}
        </AppText>
      ) : null}

      {feedback ? (
        <AppText color="inkSoft" variant="read">
          {feedback}
        </AppText>
      ) : null}

      <PrimaryButton label={isLast ? copy.finish : copy.continueLabel} onPress={onContinue} />
    </View>
  );

  // Opacity only, and a no-op under Reduce Motion — the same reveal the readers
  // already use when content replaces a placeholder.
  return reduceMotion ? content : <ContentReveal>{content}</ContentReveal>;
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    question: {
      gap: tokens.space.lg
    },
    meta: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between"
    },
    timer: {
      alignItems: "flex-end"
    },
    prompt: {
      marginTop: tokens.space.xs
    },
    options: {
      gap: tokens.space.sm
    },
    option: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      // Vertical padding rather than a fixed height: the row grows with the
      // option text and with Dynamic Type, and still clears 44pt on one line.
      minHeight: 52,
      justifyContent: "center",
      paddingHorizontal: tokens.space.lg,
      paddingVertical: tokens.space.md
    },
    optionSelected: {
      borderColor: c.accent,
      borderWidth: 2
    },
    optionText: {
      color: c.ink
    },
    skip: {
      alignSelf: "flex-start"
    },
    outcome: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.md,
      paddingTop: tokens.space.lg
    },
    outcomeHead: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md
    }
  });
