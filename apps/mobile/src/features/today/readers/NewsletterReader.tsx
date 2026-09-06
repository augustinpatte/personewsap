import { useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText, EmptyState, PrimaryButton, SecondaryButton } from "../../../components";
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
import { getQuizCopy } from "../../quiz/quizCopy";
import { readItemQuestions } from "../../quiz/itemQuestions";
import { useQuizFlow } from "../../quiz/useQuizFlow";
import { SourceList } from "./SourceList";

export function NewsletterReader({ articleId }: { articleId: string }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, getItemById, isItemComplete, markItemsComplete } = useDailyDrop();
  const copy = getReaderCopy(language);

  const item = getItemById(articleId);

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
    contentType: "newsletter_article",
    isTeam: teams.length > 0
  });

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
        eyebrow={copy.newsletterEyebrow}
        language={language}
        onClose={() => router.back()}
        quiz={quiz}
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
