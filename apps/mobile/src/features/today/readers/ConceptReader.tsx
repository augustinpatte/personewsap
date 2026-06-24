import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { AppText, EmptyState, PrimaryButton } from "../../../components";
import { tokens } from "../../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../../design/theme";
import { getConceptCategoryLabel, getReaderCopy } from "../contentCopy";
import { useDailyDrop } from "../DailyDropContext";
import { ReaderScaffold } from "./ReaderScaffold";

export function ConceptReader({ conceptId }: { conceptId: string }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, getItemById, isItemComplete, markItemsComplete } = useDailyDrop();
  const copy = getReaderCopy(language);

  const item = getItemById(conceptId);

  if (!item || item.content_type !== "key_concept") {
    return (
      <ReaderScaffold closeLabel={copy.close} onClose={() => router.back()}>
        <EmptyState
          description={
            language === "fr"
              ? "Ce concept n'est plus disponible."
              : "This concept is no longer available."
          }
          title={language === "fr" ? "Introuvable" : "Not found"}
        />
      </ReaderScaffold>
    );
  }

  const completed = isItemComplete(item.id);

  const sections = [
    { label: copy.inPlainEnglish, body: item.plain_english },
    { label: copy.definition, body: item.definition },
    { label: copy.example, body: item.example },
    { label: copy.howToUse, body: item.how_to_use_it },
    { label: copy.commonMistake, body: item.common_mistake }
  ].filter((section) => Boolean(section.body));

  const onFinish = async () => {
    if (!completed) {
      await markItemsComplete([item]);
    }
    router.back();
  };

  return (
    <ReaderScaffold
      closeLabel={copy.close}
      eyebrow={copy.conceptEyebrow}
      footer={
        <PrimaryButton label={completed ? copy.back : copy.keepConcept} onPress={onFinish} />
      }
      onClose={() => router.back()}
    >
      <AppText color="muted" variant="eyebrow">
        {getConceptCategoryLabel(item, language)}
      </AppText>

      <AppText style={styles.title} variant="display">
        {item.title}
      </AppText>

      <View style={styles.sections}>
        {sections.map((section) => (
          <View key={section.label} style={styles.section}>
            <AppText color="muted" variant="eyebrow">
              {section.label}
            </AppText>
            <AppText variant="read">{section.body}</AppText>
          </View>
        ))}
      </View>

      {item.why_it_matters ? (
        <View style={styles.matters}>
          <AppText color="accentInk" variant="eyebrow">
            {copy.whyItMatters}
          </AppText>
          <AppText variant="pullQuote">{item.why_it_matters}</AppText>
        </View>
      ) : null}
    </ReaderScaffold>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    title: {
      marginTop: tokens.space.md
    },
    sections: {
      gap: tokens.space.xl,
      marginTop: tokens.space.xl
    },
    section: {
      gap: tokens.space.sm
    },
    matters: {
      borderLeftColor: c.accent,
      borderLeftWidth: 2,
      gap: tokens.space.md,
      marginTop: tokens.space.xxl,
      paddingLeft: tokens.space.lg
    }
  });
