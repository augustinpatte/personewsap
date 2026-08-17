import { useRouter, type Href } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText, EmptyState, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { useArchive, selectNewsletterEditions, type NewsletterEditionSummary } from "../archive";
import type { LibraryItemSummary } from "../library/libraryTypes";
import { shouldShowStoredLanguageChangeNotice } from "../preferences/languageChangeNotice";
import {
  estimateReadMinutes,
  formatDropDate,
  getTopicLabel
} from "../today/contentCopy";
import { useDailyDrop } from "../today/DailyDropContext";
import { isEditionDay } from "../today/editionCadence";
import { stripMarkdownInline } from "../today/readers/markdown";
import { getModuleCopy } from "./moduleCopy";
import {
  ModuleError,
  ModuleHeader,
  ModuleLoading,
  ModuleScroll,
  ViewSwitch
} from "./ModuleChrome";
import { TodayQuietState } from "./TodayQuietState";

function readerHref(kind: "newsletter" | "concept", id: string): Href {
  return { pathname: `/(reader)/${kind}/[id]`, params: { id } } as unknown as Href;
}

export function NewsletterModuleScreen() {
  const [view, setView] = useState<"left" | "right">("left");
  const { language, drop } = useDailyDrop();
  const styles = useThemedStyles(createStyles);
  const copy = getModuleCopy(language);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.chrome}>
        <ModuleHeader
          eyebrow={formatDropDate(drop.drop_date, language)}
          language={language}
          title={copy.newsletter.title}
        />
        <ViewSwitch
          leftLabel={copy.common.todayView}
          onChange={setView}
          rightLabel={copy.common.editionsView}
          value={view}
        />
      </View>
      {view === "left" ? <NewsletterToday /> : <NewsletterArchive />}
    </SafeAreaView>
  );
}

function NewsletterToday() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, drop, status, error, isEmptyDrop, isItemComplete, reload } =
    useDailyDrop();
  const copy = getModuleCopy(language);
  const [showLanguageChangeNotice, setShowLanguageChangeNotice] = useState(false);
  const articles = drop.items.newsletter;

  useEffect(() => {
    let active = true;

    void shouldShowStoredLanguageChangeNotice(AsyncStorage, {
      currentLanguage: language,
      dropDate: drop.drop_date,
      isEditionDay: isEditionDay(drop.drop_date),
      isEmptyDrop
    })
      .then((visible) => {
        if (active) {
          setShowLanguageChangeNotice(visible);
        }
      })
      .catch(() => {
        if (active) {
          setShowLanguageChangeNotice(false);
        }
      });

    return () => {
      active = false;
    };
  }, [drop.drop_date, isEmptyDrop, language]);

  if (status === "loading") {
    return <ModuleLoading label={copy.common.loading} />;
  }

  if (isEmptyDrop && error) {
    return (
      <ModuleScroll>
        <ModuleError language={language} onRetry={reload} />
      </ModuleScroll>
    );
  }

  if (isEmptyDrop || articles.length === 0) {
    return (
      <ModuleScroll>
        {isEmptyDrop ? (
          <>
            <TodayQuietState
              dropDate={drop.drop_date}
              language={language}
              onRefresh={reload}
            />
            {showLanguageChangeNotice ? (
              <AppText color="accentInk" variant="label">
                {copy.common.languageChangeAppliesNext}
              </AppText>
            ) : null}
          </>
        ) : (
          <AppText color="muted" variant="read">
            {copy.newsletter.noModuleToday}
          </AppText>
        )}
      </ModuleScroll>
    );
  }

  const [lead, ...rest] = articles;
  const readCount = articles.filter((article) => isItemComplete(article.id)).length;

  return (
    <ModuleScroll contentStyle={styles.todayContent}>
      <AppText color="muted" variant="caption">
        {copy.newsletter.progress(readCount, articles.length)}
      </AppText>

      <Pressable
        accessibilityHint={copy.common.openHint}
        accessibilityRole="button"
        onPress={() => router.push(readerHref("newsletter", lead.id))}
        style={({ pressed }) => [styles.lead, pressed ? styles.pressed : null]}
      >
        <View style={styles.kicker}>
          <AppText variant="eyebrow">{copy.newsletter.lead}</AppText>
          <AppText color="muted" variant="eyebrow">
            {copy.common.minuteCount(estimateReadMinutes(lead))}
          </AppText>
        </View>
        <AppText color="muted" variant="caption">
          {getTopicLabel(lead.topic, language)}
        </AppText>
        <AppText style={styles.leadHeadline} variant="display">
          {lead.title}
        </AppText>
        <AppText variant="lede">{stripMarkdownInline(lead.summary)}</AppText>
        <ReadStatus
          completed={isItemComplete(lead.id)}
          completedLabel={copy.common.read}
          openLabel={copy.newsletter.readLead}
        />
      </Pressable>

      {rest.length > 0 ? (
        <View style={styles.alsoBlock}>
          <AppText color="muted" variant="eyebrow">
            {copy.newsletter.alsoInBrief}
          </AppText>
          {rest.map((article) => (
            <Pressable
              accessibilityHint={copy.common.openHint}
              accessibilityRole="button"
              key={article.id}
              onPress={() => router.push(readerHref("newsletter", article.id))}
              style={({ pressed }) => [styles.alsoItem, pressed ? styles.pressed : null]}
            >
              <AppText color="muted" variant="caption">
                {getTopicLabel(article.topic, language)}
              </AppText>
              <AppText variant="subtitle">{article.title}</AppText>
              {isItemComplete(article.id) ? (
                <View style={styles.statusRow}>
                  <View style={styles.statusDot} />
                  <AppText color="accentInk" variant="caption">
                    {copy.common.read}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </ModuleScroll>
  );
}

function ReadStatus({
  completed,
  completedLabel,
  openLabel
}: {
  completed: boolean;
  completedLabel: string;
  openLabel: string;
}) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.statusRow}>
      {completed ? <View style={styles.statusDot} /> : null}
      <AppText color="accentInk" variant="label">
        {completed ? completedLabel : `${openLabel} →`}
      </AppText>
    </View>
  );
}

function NewsletterArchive() {
  const styles = useThemedStyles(createStyles);
  const archive = useArchive();
  const copy = getModuleCopy(archive.language);
  const editions = useMemo(
    () => selectNewsletterEditions(archive.drops),
    [archive.drops]
  );

  if (archive.status === "loading") {
    return <ModuleLoading label={copy.common.loading} />;
  }

  if (editions.length === 0) {
    return (
      <ModuleScroll>
        {archive.error ? (
          <ModuleError language={archive.language} onRetry={archive.reload} />
        ) : (
          <EmptyState
            description={copy.newsletter.archiveEmptyBody}
            title={copy.newsletter.archiveEmptyTitle}
          />
        )}
      </ModuleScroll>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      data={editions}
      keyExtractor={(edition) => edition.drop_id}
      keyboardShouldPersistTaps="handled"
      ListFooterComponent={<EditionsFooter />}
      renderItem={({ item }) => <EditionGroup edition={item} />}
      showsVerticalScrollIndicator={false}
    />
  );
}

/** Older editions load only on an explicit tap: the archive stays finite. */
function EditionsFooter() {
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const archive = useArchive();
  const copy = getModuleCopy(archive.language);

  if (!archive.hasMore) {
    return null;
  }

  return (
    <View style={styles.listFooter}>
      {archive.loadingMore ? (
        <ActivityIndicator color={colors.muted} />
      ) : (
        <SecondaryButton label={copy.common.loadEarlier} onPress={archive.loadMore} />
      )}
    </View>
  );
}

function EditionGroup({ edition }: { edition: NewsletterEditionSummary }) {
  const styles = useThemedStyles(createStyles);
  const { language } = useArchive();
  const copy = getModuleCopy(language);
  const topicLine = edition.topics
    .map((topic) => getTopicLabel(topic, language))
    .join(" · ");

  return (
    <View style={styles.editionGroup}>
      <View style={styles.editionHeader}>
        <View style={styles.kicker}>
          <AppText color="muted" variant="eyebrow">
            {formatDropDate(edition.drop_date, language)}
          </AppText>
          {edition.editionType === "weekly_digest" ? (
            <AppText color="gold" variant="eyebrow">
              {copy.newsletter.weeklyDigest}
            </AppText>
          ) : null}
        </View>
        {topicLine.length > 0 ? (
          <AppText color="muted" variant="caption">
            {topicLine}
          </AppText>
        ) : null}
        <AppText color="muted" variant="caption">
          {copy.newsletter.progress(edition.readCount, edition.articleCount)}
        </AppText>
      </View>

      <View style={styles.editionItems}>
        {edition.articles.map((article) => (
          <EditionArticleRow article={article} key={article.id} />
        ))}
        {edition.extras.length > 0 ? (
          <>
            <AppText color="muted" variant="eyebrow">
              {copy.newsletter.alsoInEdition}
            </AppText>
            {edition.extras.map((extra) => (
              <EditionArticleRow article={extra} key={extra.id} />
            ))}
          </>
        ) : null}
      </View>
    </View>
  );
}

function EditionArticleRow({ article }: { article: LibraryItemSummary }) {
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const { language } = useArchive();
  const copy = getModuleCopy(language);
  const colors = useThemeColors();

  const open = () => {
    trackAnalyticsEvent("content_item_opened", {
      content_type: article.content_type,
      drop_date: article.drop_date,
      item_id: article.id
    });
    router.push(
      readerHref(article.content_type === "key_concept" ? "concept" : "newsletter", article.id)
    );
  };

  return (
    <Pressable
      accessibilityHint={copy.common.openHint}
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [styles.itemRow, pressed ? styles.pressed : null]}
    >
      <View
        style={[
          styles.itemDot,
          article.is_completed
            ? { backgroundColor: colors.accent, borderColor: colors.accent }
            : null
        ]}
      />
      <View style={styles.itemCopy}>
        <AppText numberOfLines={2} variant="body">
          {article.title}
        </AppText>
        {article.topic ? (
          <AppText color="muted" variant="caption">
            {article.topic === "career"
              ? language === "fr"
                ? "Carrière"
                : "Career"
              : getTopicLabel(article.topic, language)}
          </AppText>
        ) : null}
      </View>
      <AppText color="accentInk" variant="label">
        →
      </AppText>
    </Pressable>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    safeArea: {
      backgroundColor: c.background,
      flex: 1
    },
    chrome: {
      gap: tokens.space.lg,
      paddingHorizontal: tokens.space.lg,
      paddingTop: tokens.space.md
    },
    todayContent: {
      gap: tokens.space.lg
    },
    listContent: {
      gap: tokens.space.xl,
      paddingBottom: tokens.space.xxl,
      paddingHorizontal: tokens.space.lg,
      paddingTop: tokens.space.lg
    },
    kicker: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.sm,
      justifyContent: "space-between"
    },
    pressed: {
      opacity: 0.7
    },
    lead: {
      borderTopColor: c.borderStrong,
      borderTopWidth: 1,
      gap: tokens.space.sm,
      paddingTop: tokens.space.lg
    },
    leadHeadline: {
      marginTop: tokens.space.xs
    },
    alsoBlock: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.lg,
      paddingTop: tokens.space.lg
    },
    alsoItem: {
      gap: tokens.space.xs
    },
    statusRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.sm,
      marginTop: tokens.space.sm,
      minHeight: 32
    },
    statusDot: {
      backgroundColor: c.accent,
      borderRadius: tokens.radius.pill,
      height: 8,
      width: 8
    },
    editionGroup: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.lg,
      paddingTop: tokens.space.lg
    },
    editionHeader: {
      gap: tokens.space.xs
    },
    editionItems: {
      gap: tokens.space.lg
    },
    listFooter: {
      paddingTop: tokens.space.xl
    },
    itemRow: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: tokens.space.md,
      minHeight: 44
    },
    itemDot: {
      backgroundColor: c.surface,
      borderColor: c.borderStrong,
      borderRadius: tokens.radius.pill,
      borderWidth: 1,
      height: 8,
      marginTop: 7,
      width: 8
    },
    itemCopy: {
      flex: 1,
      gap: tokens.space.xs
    }
  });
