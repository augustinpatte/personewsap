import { useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText, EmptyState, PrimaryButton } from "../../../components";
import { tokens } from "../../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../../design/theme";
import { estimateReadMinutes, getReaderCopy } from "../contentCopy";
import { useDailyDrop } from "../DailyDropContext";
import { MarkdownBody } from "./MarkdownBody";
import { stripMarkdownInline } from "./markdown";
import { ReaderScaffold } from "./ReaderScaffold";
import { ReadingQuizScreen } from "../../quiz/ReadingQuizScreen";
import { getQuizCopy } from "../../quiz/quizCopy";
import {
  goToQuestionsAfterReading,
  readItemQuestions,
  resolveReadingCta
} from "../../quiz/itemQuestions";
import { questionListKey } from "../../quiz/useQuizFlow";
import { SourceList } from "./SourceList";

export function BusinessStoryReader({ storyId }: { storyId: string }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, getItemById, isItemComplete, markItemsComplete } = useDailyDrop();
  const copy = getReaderCopy(language);

  const item = getItemById(storyId);

  // Hooks run before the missing-item guard below, unconditionally.
  // `readItemQuestions` is null-safe and returns an empty block for a missing
  // or legacy item, which is what keeps the hook order identical on every
  // render.
  const { questions } = readItemQuestions(item);
  const [showQuiz, setShowQuiz] = useState(false);

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
  const cta = resolveReadingCta({ questionCount: questions.length, completed });
  const chapters = [
    { label: copy.setup, body: item.setup },
    { label: copy.tension, body: item.tension },
    { label: copy.decision, body: item.decision },
    { label: copy.outcome, body: item.outcome }
  ].filter((chapter) => Boolean(chapter.body));

  // Legacy content, with no questions: the end-of-reading button it always had.
  const onFinish = async () => {
    if (!completed) {
      await markItemsComplete([item]);
    }

    router.back();
  };

  // Scored content: read, then straight to this story's own questions.
  const onGoToQuestions = () => {
    void goToQuestionsAfterReading({
      completed,
      markRead: () => markItemsComplete([item]),
      openQuestions: () => setShowQuiz(true)
    });
  };

  if (showQuiz) {
    // Business Stories are Solo, always: no team badge and no team flag.
    return (
      <ReadingQuizScreen
        contentType="business_story"
        eyebrow={copy.storyEyebrow}
        isTeam={false}
        key={questionListKey(questions)}
        language={language}
        onBackToContent={() => setShowQuiz(false)}
        onClose={() => router.back()}
        questions={questions}
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
        cta === "go_to_questions" ? (
          <PrimaryButton label={getQuizCopy(language).goToQuestions} onPress={onGoToQuestions} />
        ) : (
          <PrimaryButton label={cta === "back" ? copy.back : copy.markRead} onPress={onFinish} />
        )
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
