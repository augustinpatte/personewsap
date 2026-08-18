import { useRouter, type Href } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText, Card } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../design/theme";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { selectArchiveItems, useArchiveData } from "../archive";
import type { LibraryItemSummary } from "../library/libraryTypes";
import { useModulePreferenceState } from "../preferences";
import { estimateReadMinutes, formatDropDate } from "../today/contentCopy";
import { useDailyDrop } from "../today/DailyDropContext";
import { stripMarkdownInline } from "../today/readers/markdown";
import { ItemArchiveList } from "./ItemArchiveList";
import { getModuleCopy } from "./moduleCopy";
import {
  ModuleError,
  ModuleDisabledState,
  ModuleHeader,
  ModuleLoading,
  MetaLine,
  ModuleScroll,
  ViewSwitch
} from "./ModuleChrome";
import { TodayQuietState } from "./TodayQuietState";

function storyHref(id: string): Href {
  return { pathname: "/(reader)/story/[id]", params: { id } } as unknown as Href;
}

export function StoriesModuleScreen() {
  const [view, setView] = useState<"left" | "right">("left");
  const { language, drop } = useDailyDrop();
  const modulePreference = useModulePreferenceState("business_story");
  const styles = useThemedStyles(createStyles);
  const copy = getModuleCopy(language);
  const disabled = modulePreference.status === "ready" && !modulePreference.enabled;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.chrome}>
        <ModuleHeader
          eyebrow={formatDropDate(drop.drop_date, language)}
          iconName="briefcase"
          metaItems={[
            copy.common.editionRhythm,
            copy.stories.headerMeta,
            storyHeaderMeta(drop.items.business_story)
          ]}
          title={copy.stories.title}
        />
        {disabled ? null : (
          <ViewSwitch
            leftLabel={copy.common.todayView}
            onChange={setView}
            rightLabel={copy.common.archiveView}
            value={view}
          />
        )}
      </View>
      {disabled ? (
        <ModuleScroll>
          <ModuleDisabledState language={language} moduleId="business_story" />
        </ModuleScroll>
      ) : view === "left" ? (
        <StoriesToday />
      ) : (
        <StoriesArchive />
      )}
    </SafeAreaView>
  );
}

function StoriesToday() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  const { language, drop, status, error, isEmptyDrop, isItemComplete, reload } =
    useDailyDrop();
  const copy = getModuleCopy(language);
  const story = drop.items.business_story;

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

  if (isEmptyDrop) {
    return (
      <ModuleScroll>
        <TodayQuietState
          dropDate={drop.drop_date}
          iconName="briefcase"
          language={language}
          onRefresh={reload}
        />
      </ModuleScroll>
    );
  }

  if (!story) {
    return (
      <ModuleScroll>
        <AppText color="muted" variant="read">
          {copy.stories.noModuleToday}
        </AppText>
      </ModuleScroll>
    );
  }

  const completed = isItemComplete(story.id);

  return (
    <ModuleScroll>
      <Pressable
        accessibilityHint={copy.common.openHint}
        accessibilityRole="button"
        onPress={() => router.push(storyHref(story.id))}
        style={({ pressed }) => (pressed ? styles.pressed : null)}
      >
        {/* Read as a company dossier: a filed label, the subject on the tab,
            then the case itself. The monogram carries the identity — never a
            real logo, never a remote image. */}
        <Card padding="lg" style={styles.storyCard}>
          <View style={styles.dossierTab}>
            <AppText color="accentInk" variant="eyebrow">
              {copy.stories.kicker}
            </AppText>
          </View>

          <View style={styles.storyHeader}>
            <Monogram label={story.company_or_market} />
            <View style={styles.storyHeaderCopy}>
              <AppText numberOfLines={2} variant="bodyStrong">
                {story.company_or_market}
              </AppText>
              <AppText color="muted" variant="caption">
                {copy.common.minuteCount(estimateReadMinutes(story))}
              </AppText>
            </View>
          </View>

          <MetaLine
            items={[
              story.company_or_market,
              story.story_date ? story.story_date.slice(0, 4) : null,
              copy.stories.headerMeta
            ]}
          />

          <View style={styles.dossierRule} />

          <AppText variant="title">{story.title}</AppText>
          <AppText color="inkSoft" variant="read">
            {stripMarkdownInline(story.setup)}
          </AppText>

          <View style={styles.statusRow}>
            {completed ? <View style={styles.statusDot} /> : null}
            <AppText color="accentInk" variant="label">
              {completed ? copy.common.read : `${copy.stories.readStory} →`}
            </AppText>
          </View>
        </Card>
      </Pressable>
    </ModuleScroll>
  );
}

function storyHeaderMeta(
  story: ReturnType<typeof useDailyDrop>["drop"]["items"]["business_story"]
) {
  if (!story) {
    return null;
  }

  return `${story.company_or_market} · ${story.story_date.slice(0, 4)}`;
}

function StoriesArchive() {
  const router = useRouter();
  const styles = useThemedStyles(createStyles);
  // Rendering the Archive view is what loads the archive (see useArchiveData).
  const archive = useArchiveData();
  const copy = getModuleCopy(archive.language);
  const stories = useMemo(
    () => selectArchiveItems(archive.drops, "business_story"),
    [archive.drops]
  );

  const openStory = (item: LibraryItemSummary) => {
    trackAnalyticsEvent("content_item_opened", {
      content_type: item.content_type,
      drop_date: item.drop_date,
      item_id: item.id
    });
    router.push(storyHref(item.id));
  };

  return (
    <ItemArchiveList
      emptyBody={copy.stories.archiveEmptyBody}
      emptyTitle={copy.stories.archiveEmptyTitle}
      contentType="business_story"
      items={stories}
      onOpen={openStory}
      renderMeta={(item) =>
        item.is_completed ? (
          <View style={styles.statusRow}>
            <View style={styles.statusDot} />
            <AppText color="accentInk" variant="caption">
              {copy.common.read}
            </AppText>
          </View>
        ) : null
      }
      searchAccessibilityLabel={copy.stories.searchAccessibility}
      searchPlaceholder={copy.stories.searchPlaceholder}
    />
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
    safeArea: {
      backgroundColor: c.background,
      flex: 1
    },
    chrome: {
      gap: tokens.space.lg,
      paddingHorizontal: tokens.space.lg,
      paddingTop: tokens.space.md
    },
    pressed: {
      opacity: 0.7
    },
    storyCard: {
      gap: tokens.space.md
    },
    // The filed-label tab that tells the card apart from a generic Card.
    dossierTab: {
      alignSelf: "flex-start",
      backgroundColor: c.accentSoft,
      borderRadius: tokens.radius.xs,
      paddingHorizontal: tokens.space.sm,
      paddingVertical: 3
    },
    dossierRule: {
      backgroundColor: c.border,
      height: 1
    },
    storyHeader: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md
    },
    storyHeaderCopy: {
      flex: 1,
      gap: tokens.space.xs
    },
    monogram: {
      alignItems: "center",
      borderColor: c.borderStrong,
      borderRadius: tokens.radius.pill,
      borderWidth: 1,
      height: 44,
      justifyContent: "center",
      width: 44
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
    }
  });
