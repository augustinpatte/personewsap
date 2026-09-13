import { useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText, EmptyState, PrimaryButton } from "../../../components";
import { tokens } from "../../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../../design/theme";
import {
  estimateReadMinutes,
  formatDropDate,
  getReaderCopy,
  getTopicLabel
} from "../contentCopy";
import { useDailyDrop } from "../DailyDropContext";
import { MarkdownBody } from "./MarkdownBody";
import { stripMarkdownInline } from "./markdown";
import { ReaderScaffold } from "./ReaderScaffold";
import { ReadingQuizScreen } from "../../quiz/ReadingQuizScreen";
import { getQuizCopy, questionsCtaLabel } from "../../quiz/quizCopy";
import { goToQuestionsAfterReading, resolveReadingCta } from "../../quiz/itemQuestions";
import { resolveQuestionsCta } from "../../quiz/questionProgress";
import { useReadingQuestions } from "../../quiz/useReadingQuestions";
import { questionListKey } from "../../quiz/useQuizFlow";
import { SourceList } from "./SourceList";

export function NewsletterReader({ articleId }: { articleId: string }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, getItemById, isItemComplete, markItemsComplete } = useDailyDrop();
  const copy = getReaderCopy(language);

  const item = getItemById(articleId);

  // Hooks run before the missing-item guard below, unconditionally. The
  // questions and the reader's server-side progress on them are null-safe on a
  // missing or legacy item, which keeps the hook order identical on every
  // render.
  const { questions, teams, progress, progressKnown, settled } = useReadingQuestions(item);
  const [showQuiz, setShowQuiz] = useState(false);

  if (!item || item.content_type !== "newsletter_article") {
    return (
      <ReaderScaffold closeLabel={copy.close} onClose={() => router.back()}>
        <EmptyState
          description={
            language === "fr"
              ? "Cet article n'est plus disponible."
              : "This article is no longer available."
          }
          iconName="file-text"
          title={language === "fr" ? "Introuvable" : "Not found"}
        />
      </ReaderScaffold>
    );
  }

  const completed = isItemComplete(item.id);
  const cta = resolveReadingCta({ questionCount: questions.length, completed });
  const quizCopy = getQuizCopy(language);

  // Legacy content, with no questions: the end-of-reading button it always had.
  const onFinish = async () => {
    if (!completed) {
      await markItemsComplete([item]);
    }

    router.back();
  };

  // Scored content: read, then straight to this article's own questions —
  // resumed where the server says the reader stopped.
  const onGoToQuestions = () => {
    void goToQuestionsAfterReading({
      completed,
      markRead: () => markItemsComplete([item]),
      openQuestions: () => setShowQuiz(true)
    });
  };

  if (showQuiz) {
    return (
      <ReadingQuizScreen
        contentType="newsletter_article"
        eyebrow={copy.newsletterEyebrow}
        isTeam={teams.length > 0}
        key={questionListKey(questions)}
        language={language}
        onBackToContent={() => setShowQuiz(false)}
        onClose={() => router.back()}
        questions={questions}
        settled={settled}
        teams={teams}
        title={item.title}
      />
    );
  }

  return (
    <ReaderScaffold
      closeLabel={copy.close}
      eyebrow={copy.newsletterEyebrow}
      iconName="file-text"
      footer={
        cta === "go_to_questions" ? (
          <View style={styles.footerActions}>
            {progressKnown ? (
              <AppText color="muted" variant="caption">
                {quizCopy.questionsProgress(progress.settled, progress.total)}
              </AppText>
            ) : null}
            <PrimaryButton
              label={questionsCtaLabel(resolveQuestionsCta(progress), quizCopy)}
              onPress={onGoToQuestions}
            />
          </View>
        ) : (
          <PrimaryButton label={cta === "back" ? copy.back : copy.markRead} onPress={onFinish} />
        )
      }
      onClose={() => router.back()}
    >
      <AppText color="muted" variant="eyebrow">
        {`${getTopicLabel(item.topic, language)} · ${copy.minutes(estimateReadMinutes(item))}`}
      </AppText>

      <AppText style={styles.headline} variant="display">
        {item.title}
      </AppText>

      <AppText color="muted" style={styles.dateline} variant="caption">
        {formatDropDate(item.published_date, language)}
      </AppText>

      <AppText style={styles.lede} variant="lede">
        {stripMarkdownInline(item.summary)}
      </AppText>

      <View style={styles.rule} />

      <MarkdownBody markdown={item.body_md} />

      <View style={styles.matters}>
        <AppText color="accentInk" variant="eyebrow">
          {copy.whyItMatters}
        </AppText>
        <AppText variant="pullQuote">{stripMarkdownInline(item.why_it_matters)}</AppText>
      </View>

      {/* Per article, never per edition: each newsletter article is its own
          content item with its own cited records, so the sources shown here are
          the ones behind the piece just read and nothing else. */}
      <SourceList language={language} sources={item.sources} />
    </ReaderScaffold>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    footerActions: {
      gap: tokens.space.sm
    },
    headline: {
      marginTop: tokens.space.md
    },
    dateline: {
      marginTop: tokens.space.sm,
      textTransform: "capitalize"
    },
    lede: {
      marginTop: tokens.space.lg
    },
    rule: {
      backgroundColor: c.borderStrong,
      height: 1,
      marginVertical: tokens.space.xl,
      width: 48
    },
    matters: {
      borderLeftColor: c.accent,
      borderLeftWidth: 2,
      gap: tokens.space.md,
      marginTop: tokens.space.xxl,
      paddingLeft: tokens.space.lg
    }
  });
