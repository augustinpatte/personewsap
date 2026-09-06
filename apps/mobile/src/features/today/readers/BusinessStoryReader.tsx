import { useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText, EmptyState, PrimaryButton, SecondaryButton } from "../../../components";
import { tokens } from "../../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../../design/theme";
import { estimateReadMinutes, getReaderCopy } from "../contentCopy";
import { useDailyDrop } from "../DailyDropContext";
import { MarkdownBody } from "./MarkdownBody";
import { stripMarkdownInline } from "./markdown";
import { ReaderScaffold } from "./ReaderScaffold";
import { ReadingQuizScreen } from "../../quiz/ReadingQuizScreen";
import { getQuizCopy } from "../../quiz/quizCopy";
import { readItemQuestions } from "../../quiz/itemQuestions";
import { useQuizFlow } from "../../quiz/useQuizFlow";
import { SourceList } from "./SourceList";

export function BusinessStoryReader({ storyId }: { storyId: string }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, getItemById, isItemComplete, markItemsComplete } = useDailyDrop();
  const copy = getReaderCopy(language);

  const item = getItemById(storyId);

  // Hooks run before the missing-item guard below, unconditionally.
  // `readItemQuestions` is null-safe and returns an empty block for a
  // missing or legacy item, so the quiz simply has nothing to do — which
  // is what lets the hook order stay identical on every render.
  const { questions, teams } = readItemQuestions(item);
  const [showQuiz, setShowQuiz] = useState(false);
  // Was this already read when the screen opened? Captured once, with the other
  // hooks and before the missing-item guard, because it decides what the footer
  // button MEANS — and marking it read below must not change that answer
  // mid-render. `isItemComplete` is safe on an absent id.
  const [wasAlreadyRead] = useState(() => isItemComplete(item?.id ?? ""));
  const quiz = useQuizFlow({
    questions,
    active: showQuiz,
    contentType: "business_story",
    isTeam: false
  });

  if (!item || item.content_type !== "business_story") {
    return (
      <ReaderScaffold closeLabel={copy.close} onClose={() => router.back()}>
        <EmptyState
          description={
            language === "fr"
              ? "Cette histoire n'est plus disponible."
              : "This story is no longer available."
          }
          iconName="briefcase"
          title={language === "fr" ? "Introuvable" : "Not found"}
        />
      </ReaderScaffold>
    );
  }

  const completed = isItemComplete(item.id);
  const chapters = [
    { label: copy.setup, body: item.setup },
    { label: copy.tension, body: item.tension },
    { label: copy.decision, body: item.decision },
    { label: copy.outcome, body: item.outcome }
  ].filter((chapter) => Boolean(chapter.body));

  const onFinish = async () => {
    if (!completed) {
      // The existing completion semantics, unchanged: the article is read the
      // moment the reader says so, whatever happens to the questions after.
      await markItemsComplete([item]);

      if (questions.length > 0 && quiz.hasPending) {
        setShowQuiz(true);
        return;
      }
    }

    // A reading that was ALREADY read — including everything completed before
    // questions existed at all — closes. Its button says "Back", and a button
    // that says Back must go back. The quiz is offered beside it, never behind
    // it: nobody who finished an article last month gets a quiz sprung on them
    // for tapping the thing that used to dismiss the screen.
    router.back();
  };

  if (showQuiz) {
    return (
      <ReadingQuizScreen
        eyebrow={copy.storyEyebrow}
        language={language}
        onClose={() => router.back()}
        quiz={quiz}
        teams={[]}
        title={item.title}
      />
    );
  }

  return (
    <ReaderScaffold
      closeLabel={copy.close}
      eyebrow={copy.storyEyebrow}
      iconName="briefcase"
      footer={
        <View style={styles.footerActions}>
          {wasAlreadyRead && questions.length > 0 && quiz.hasPending ? (
            <SecondaryButton
              label={getQuizCopy(language).continueChallenge}
              onPress={() => setShowQuiz(true)}
            />
          ) : null}
          <PrimaryButton label={completed ? copy.back : copy.markRead} onPress={onFinish} />
        </View>
      }
      onClose={() => router.back()}
    >
      <View style={styles.identity}>
        <Monogram label={item.company_or_market} />
        <AppText color="muted" variant="eyebrow">
          {`${item.company_or_market} · ${copy.minutes(estimateReadMinutes(item))}`}
        </AppText>
      </View>

      <AppText style={styles.title} variant="title">
        {item.title}
      </AppText>

      <View style={styles.chapters}>
        {chapters.map((chapter, index) => (
          <View key={chapter.label} style={styles.chapter}>
            <View style={styles.chapterHead}>
              <AppText color="mutedSoft" style={styles.chapterNumber} variant="eyebrow">
                {`${index + 1}`.padStart(2, "0")}
              </AppText>
              <AppText color="muted" variant="eyebrow">
                {chapter.label}
              </AppText>
            </View>
            <MarkdownBody markdown={chapter.body} />
          </View>
        ))}
      </View>

      <View style={styles.lesson}>
        <AppText color="accentInk" variant="eyebrow">
          {copy.lesson}
        </AppText>
        <AppText variant="pullQuote">{stripMarkdownInline(item.lesson)}</AppText>
      </View>

      {/* After the lesson, in secondary type: the story is what the reader came
          for, and the record it rests on belongs behind it, not beside it. */}
      <SourceList language={language} sources={item.sources} />
    </ReaderScaffold>
  );
}

function Monogram({ label }: { label: string }) {
  const styles = useThemedStyles(createStyles);
  const initial = label.trim().charAt(0).toUpperCase() || "•";

  return (
    <View style={styles.monogram}>
      <AppText color="accentInk" variant="subtitle">
        {initial}
      </AppText>
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    footerActions: {
      gap: tokens.space.sm
    },
    identity: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md,
      marginTop: tokens.space.sm
    },
    monogram: {
      alignItems: "center",
      borderColor: c.borderStrong,
      borderRadius: tokens.radius.pill,
      borderWidth: 1,
      height: 40,
      justifyContent: "center",
      width: 40
    },
    title: {
      marginTop: tokens.space.lg
    },
    chapters: {
      gap: tokens.space.xl,
      marginTop: tokens.space.xl
    },
    chapter: {
      gap: tokens.space.sm
    },
    chapterHead: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md
    },
    chapterNumber: {
      letterSpacing: tokens.typography.tracking.smallCaps
    },
    lesson: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      gap: tokens.space.md,
      marginTop: tokens.space.xxl,
      padding: tokens.space.xl
    }
  });
