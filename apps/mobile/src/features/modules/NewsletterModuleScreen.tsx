import { useRouter, type Href } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  AppText,
  EmptyState,
  PressableSurface,
  SecondaryButton
} from "../../components";
import { usePressedSurfaceStyle } from "../../design/usePressedSurfaceStyle";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { trackAnalyticsEvent } from "../../lib/analytics";
import {
  resolveArchiveEmptyState,
  selectNewsletterEditions,
  useArchive,
  useArchiveData,
  type NewsletterEditionSummary
} from "../archive";
import type { LibraryItemSummary } from "../library/libraryTypes";
import { useModulePreferenceState } from "../preferences";
import { shouldShowStoredLanguageChangeNotice } from "../preferences/languageChangeNotice";
import {
  estimateReadMinutes,
  editionDisplayDate,
  getTopicLabel
} from "../today/contentCopy";
import { useDailyDrop } from "../today/DailyDropContext";
import { resolveTodayEditionState } from "../today/todayEditionState";
import { isEditionDay } from "../today/editionCadence";
import { stripMarkdownInline } from "../today/readers/markdown";
import { getModuleCopy } from "./moduleCopy";
import {
  EditorialRule,
  MetaLine,
  ModuleDisabledState,
  ModuleError,
  EditionProgress,
  ModuleHeader,
  ModuleLoading,
  ModuleScroll,
  ViewSwitch
} from "./ModuleChrome";
import { TodayQuietState } from "./TodayQuietState";
import { useEditionProgress } from "./useEditionProgress";

function readerHref(kind: "newsletter" | "concept", id: string): Href {
  return { pathname: `/(reader)/${kind}/[id]`, params: { id } } as unknown as Href;
}

export function NewsletterModuleScreen() {
  const [view, setView] = useState<"left" | "right">("left");
  const { language, drop } = useDailyDrop();
  const modulePreference = useModulePreferenceState("newsletter");
  const styles = useThemedStyles(createStyles);
  const copy = getModuleCopy(language);
  const editionProgress = useEditionProgress();
  const disabled = modulePreference.status === "ready" && !modulePreference.enabled;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.chrome}>
        <ModuleHeader
          eyebrow={editionDisplayDate(drop, language) ?? copy.common.undatedEdition}
          iconName="file-text"
          metaItems={[
            copy.common.editionRhythm,
            copy.newsletter.articleCount(drop.items.newsletter.length),
            copy.common.archiveAccess
          ]}
          title={copy.newsletter.title}
        />
        {disabled ? null : (
          <>
            {/* Today's session, not this tab's: the same line appears on
                Stories and Mini cases, counting the same edition. */}
            {view === "left" ? (
              <EditionProgress language={language} state={editionProgress} />
            ) : null}
            <ViewSwitch
              leftLabel={copy.common.todayView}
              onChange={setView}
              rightLabel={copy.common.editionsView}
              value={view}
            />
          </>
        )}
      </View>
      {disabled ? (
        <ModuleScroll>
          <ModuleDisabledState language={language} moduleId="newsletter" />
        </ModuleScroll>
      ) : view === "left" ? (
        <NewsletterToday onOpenArchive={() => setView("right")} />
      ) : (
        <NewsletterArchive />
      )}
    </SafeAreaView>
  );
}

function NewsletterToday({ onOpenArchive }: { onOpenArchive: () => void }) {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, drop, status, error, isEmptyDrop, isItemComplete, reload } =
    useDailyDrop();
  const copy = getModuleCopy(language);
  const [showLanguageChangeNotice, setShowLanguageChangeNotice] = useState(false);
  const articles = drop.items.newsletter;
  const editionState = resolveTodayEditionState({
    dropDate: drop.drop_date,
    error,
    isEmptyDrop,
    status
  });

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

  if (editionState === "loading") {
    return <ModuleLoading label={copy.common.loading} />;
  }

  if (editionState === "error") {
    return (
      <ModuleScroll>
        <ModuleError language={language} onRetry={reload} />
      </ModuleScroll>
    );
  }

  if (editionState === "upcoming" || editionState === "quiet") {
    return (
      <ModuleScroll>
        <TodayQuietState
          dropDate={drop.drop_date}
          iconName="calendar"
          language={language}
          onOpenArchive={onOpenArchive}
          onRefresh={reload}
          state={editionState}
        />
        {showLanguageChangeNotice ? (
          <AppText color="accentInk" variant="label">
            {copy.common.languageChangeAppliesNext}
          </AppText>
        ) : null}
      </ModuleScroll>
    );
  }

  // The edition exists but carries no newsletter — the other tabs do have
  // something today, so this is not a quiet day.
  if (articles.length === 0) {
    return (
      <ModuleScroll>
        <AppText color="muted" variant="read">
          {copy.newsletter.noModuleToday}
        </AppText>
      </ModuleScroll>
    );
  }

  const [lead, ...rest] = articles;
  const readCount = articles.filter((article) => isItemComplete(article.id)).length;

  return (
    <ModuleScroll contentStyle={styles.todayContent} reveal>
      {/* Masthead line: the edition, then how far through it you are. Reads as
          the top of a front page rather than as a progress widget. */}
      <View style={styles.masthead}>
        <MetaLine
          items={[
            editionDisplayDate(drop, language),
            copy.newsletter.progress(readCount, articles.length)
          ]}
        />
        <EditorialRule />
      </View>

      <PressableSurface
        accessibilityHint={copy.common.openHint}
        onPress={() => router.push(readerHref("newsletter", lead.id))}
        style={styles.lead}
      >
        <View style={styles.kicker}>
          <AppText variant="eyebrow">{copy.newsletter.lead}</AppText>
        </View>
        <AppText style={styles.leadHeadline} variant="display">
          {lead.title}
        </AppText>
        <MetaLine
          items={[
            getTopicLabel(lead.topic, language),
            copy.common.minuteCount(estimateReadMinutes(lead))
          ]}
        />
        <AppText variant="lede">{stripMarkdownInline(lead.summary)}</AppText>
        <ReadStatus
          completed={isItemComplete(lead.id)}
          completedLabel={copy.common.read}
          openLabel={copy.newsletter.readLead}
        />
      </PressableSurface>

      {rest.length > 0 ? (
        <View style={styles.alsoBlock}>
          {/* The rule carries the section name, so the secondaries read as a
              column under the lead instead of as more cards. */}
          <EditorialRule label={copy.newsletter.alsoInBrief} />
          {rest.map((article) => (
            <PressableSurface
              accessibilityHint={copy.common.openHint}
              key={article.id}
              onPress={() => router.push(readerHref("newsletter", article.id))}
              style={styles.alsoItem}
              variant="row"
            >
              <AppText style={styles.alsoHeadline} variant="subtitle">
                {article.title}
              </AppText>
              <MetaLine
                items={[
                  getTopicLabel(article.topic, language),
                  copy.common.minuteCount(estimateReadMinutes(article)),
                  isItemComplete(article.id) ? copy.common.read : null
                ]}
                tone={isItemComplete(article.id) ? "accentInk" : "muted"}
              />
            </PressableSurface>
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
  // Rendering the Editions view is what loads the archive; the app start does
  // not need it.
  const archive = useArchiveData();
  const copy = getModuleCopy(archive.language);
  const editions = useMemo(
    () => selectNewsletterEditions(archive.drops),
    [archive.drops]
  );

  if (archive.status !== "ready") {
    return <ModuleLoading label={copy.common.loading} />;
  }

  const emptyState = resolveArchiveEmptyState({
    itemCount: editions.length,
    isSearchActive: false,
    hasError: Boolean(archive.error),
    hasMore: archive.hasMore
  });

  if (emptyState === "error") {
    return (
      <ModuleScroll>
        <ModuleError language={archive.language} onRetry={archive.reload} />
      </ModuleScroll>
    );
  }

  // Same rule as the other modules: loaded editions carrying no newsletter is
  // not an empty archive, and the reader keeps an explicit way further back.
  if (emptyState === "load-earlier") {
    return (
      <ModuleScroll>
        <EmptyState
          actionLabel={archive.loadingMore ? undefined : copy.common.seeEarlierEditions}
          description={copy.common.noneInLoadedBody}
          iconName="archive"
          onActionPress={archive.loadingMore ? undefined : archive.loadMore}
          title={copy.common.noneInLoadedTitle}
        />
      </ModuleScroll>
    );
  }

  if (emptyState === "empty") {
    return (
      <ModuleScroll>
        <EmptyState
          description={copy.newsletter.archiveEmptyBody}
          iconName="archive"
          title={copy.newsletter.archiveEmptyTitle}
        />
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
            {editionDisplayDate(
              { drop_date: edition.drop_date, hide_display_date: edition.hideDisplayDate },
              language
            ) ?? copy.common.undatedEdition}
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
  // A list row is tinted, never scaled, and never given its own Animated.Value:
  // scaling one row inside a list reads as the list shifting.
  const pressedSurface = usePressedSurfaceStyle();

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
      style={({ pressed }) => [styles.itemRow, pressed ? pressedSurface : null]}
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
    masthead: {
      gap: tokens.space.sm
    },
    // The lead owns the top of the page: no rule above it (the masthead already
    // draws one) and generous air, so the eye lands on the headline first.
    // The negative margin against equal padding is what gives the pressed tint
    // a shape: the highlight reaches a little past the text on both sides, the
    // way an iOS list row does, while the type stays exactly where it was.
    lead: {
      borderRadius: tokens.radius.md,
      gap: tokens.space.sm,
      marginHorizontal: -tokens.space.md,
      paddingBottom: tokens.space.md,
      paddingHorizontal: tokens.space.md
    },
    leadHeadline: {
      marginTop: tokens.space.xs
    },
    alsoBlock: {
      gap: tokens.space.lg
    },
    // Secondaries are deliberately tighter than the lead: title then one quiet
    // metadata line, nothing else competing.
    alsoItem: {
      borderRadius: tokens.radius.md,
      gap: tokens.space.xs,
      marginHorizontal: -tokens.space.md,
      minHeight: 44,
      paddingHorizontal: tokens.space.md,
      paddingVertical: tokens.space.sm
    },
    alsoHeadline: {
      lineHeight: 24
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
