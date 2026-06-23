import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText, EmptyState, PrimaryButton } from "../../../components";
import { tokens } from "../../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../../design/theme";
import { estimateReadMinutes, getReaderCopy } from "../contentCopy";
import { useDailyDrop } from "../DailyDropContext";
import { DropCapParagraph } from "./DropCapParagraph";
import { ReaderScaffold } from "./ReaderScaffold";

export function BusinessStoryReader({ storyId }: { storyId: string }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, getItemById, isItemComplete, markItemsComplete } = useDailyDrop();
  const copy = getReaderCopy(language);

  const item = getItemById(storyId);

  if (!item || item.content_type !== "business_story") {
    return (
      <ReaderScaffold closeLabel={copy.close} onClose={() => router.back()}>
        <EmptyState
          description={
            language === "fr"
              ? "Cette histoire n'est plus disponible."
              : "This story is no longer available."
          }
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
      await markItemsComplete([item]);
    }
    router.back();
  };

  return (
    <ReaderScaffold
      closeLabel={copy.close}
      eyebrow={copy.storyEyebrow}
      footer={
        <PrimaryButton label={completed ? copy.back : copy.markRead} onPress={onFinish} />
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
            {index === 0 ? (
              <DropCapParagraph text={chapter.body} />
            ) : (
              <AppText variant="read">{chapter.body}</AppText>
            )}
          </View>
        ))}
      </View>

      <View style={styles.lesson}>
        <AppText color="accentInk" variant="eyebrow">
          {copy.lesson}
        </AppText>
        <AppText variant="pullQuote">{item.lesson}</AppText>
      </View>
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
      letterSpacing: 1.4
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
