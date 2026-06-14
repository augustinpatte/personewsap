import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText, EmptyState, PrimaryButton } from "../../../components";
import { tokens } from "../../../design/tokens";
import {
  estimateReadMinutes,
  formatDropDate,
  getReaderCopy,
  getTopicLabel,
  splitParagraphs
} from "../contentCopy";
import { useDailyDrop } from "../DailyDropContext";
import { ReaderScaffold } from "./ReaderScaffold";

export function NewsletterReader({ articleId }: { articleId: string }) {
  const router = useRouter();
  const { language, getItemById, isItemComplete, markItemsComplete } = useDailyDrop();
  const copy = getReaderCopy(language);

  const item = getItemById(articleId);

  if (!item || item.content_type !== "newsletter_article") {
    return (
      <ReaderScaffold closeLabel={copy.close} onClose={() => router.back()}>
        <EmptyState
          description={
            language === "fr"
              ? "Cet article n'est plus disponible."
              : "This article is no longer available."
          }
          title={language === "fr" ? "Introuvable" : "Not found"}
        />
      </ReaderScaffold>
    );
  }

  const completed = isItemComplete(item.id);
  const paragraphs = splitParagraphs(item.body_md);

  const onFinish = async () => {
    if (!completed) {
      await markItemsComplete([item]);
    }
    router.back();
  };

  return (
    <ReaderScaffold
      closeLabel={copy.close}
      eyebrow={copy.newsletterEyebrow}
      footer={
        <PrimaryButton label={completed ? copy.back : copy.markRead} onPress={onFinish} />
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
        {item.summary}
      </AppText>

      <View style={styles.rule} />

      <View style={styles.body}>
        {paragraphs.map((paragraph, index) => (
          <AppText key={index} variant="read">
            {paragraph}
          </AppText>
        ))}
      </View>

      <View style={styles.matters}>
        <AppText color="muted" variant="eyebrow">
          {copy.whyItMatters}
        </AppText>
        <AppText style={styles.mattersBody} variant="quote">
          {item.why_it_matters}
        </AppText>
      </View>
    </ReaderScaffold>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: tokens.color.borderStrong,
    height: 1,
    marginVertical: tokens.space.xl,
    width: 48
  },
  body: {
    gap: tokens.space.lg
  },
  matters: {
    borderLeftColor: tokens.color.accent,
    borderLeftWidth: 2,
    gap: tokens.space.sm,
    marginTop: tokens.space.xxl,
    paddingLeft: tokens.space.lg
  },
  mattersBody: {
    color: tokens.color.ink
  }
});
