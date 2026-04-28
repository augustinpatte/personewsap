import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle
} from "react-native";

import { TOPICS, type TopicId } from "../../src/constants/product";
import {
  AppScreen,
  AppText,
  Card,
  DataModeBanner,
  EmptyState,
  ProgressPill,
  SecondaryButton,
  SectionHeader
} from "../../src/components";
import { tokens } from "../../src/design/tokens";
import { fetchLibraryDrops, type LibraryDropSummary, type LibraryItemSummary } from "../../src/features/library";
import type { ContentType } from "../../src/features/today";
import type { DataFallbackReason, DataFetchSource } from "../../src/lib/dataState";
import { getAuthSession, type NormalizedSupabaseError } from "../../src/lib/supabase";
import { mockLibraryDrops, mockLibraryItems } from "../../src/mocks";

type ContentFilterId = "all" | "newsletter" | "business_story" | "mini_case" | "concept";
type TopicFilterId = "all" | TopicId;
type LibraryFallbackReason = DataFallbackReason | "missing_auth_session";

type LibraryLoadState = {
  drops: LibraryDropSummary[];
  error: NormalizedSupabaseError | null;
  fallbackReason: LibraryFallbackReason | null;
  source: DataFetchSource;
  status: "loading" | "ready";
};

const contentFilters: Array<{
  id: ContentFilterId;
  label: string;
  contentTypes: ContentType[];
}> = [
  {
    id: "all",
    label: "All",
    contentTypes: [
      "newsletter_article",
      "business_story",
      "mini_case",
      "key_concept"
    ]
  },
  { id: "newsletter", label: "Newsletter", contentTypes: ["newsletter_article"] },
  { id: "business_story", label: "Business story", contentTypes: ["business_story"] },
  { id: "mini_case", label: "Mini-case", contentTypes: ["mini_case"] },
  { id: "concept", label: "Concept", contentTypes: ["key_concept"] }
];

const topicFilters: Array<{ id: TopicFilterId; label: string }> = [
  { id: "all", label: "All topics" },
  ...TOPICS.map((topic) => ({ id: topic.id, label: topic.label }))
];

const contentLabels: Record<ContentType, string> = {
  newsletter_article: "Newsletter",
  business_story: "Business story",
  mini_case: "Mini-case",
  key_concept: "Concept"
};

const archiveSlots: Array<{
  id: ContentFilterId;
  label: string;
  contentTypes: ContentType[];
}> = [
  { id: "newsletter", label: "Newsletter", contentTypes: ["newsletter_article"] },
  { id: "business_story", label: "Business story", contentTypes: ["business_story"] },
  { id: "mini_case", label: "Mini-case", contentTypes: ["mini_case"] },
  { id: "concept", label: "Concept", contentTypes: ["key_concept"] }
];

const topicLabels = TOPICS.reduce<Record<TopicId, string>>((labels, topic) => {
  labels[topic.id] = topic.label;
  return labels;
}, {} as Record<TopicId, string>);

export default function LibraryScreen() {
  const [activeContentFilter, setActiveContentFilter] =
    useState<ContentFilterId>("all");
  const [activeTopicFilter, setActiveTopicFilter] = useState<TopicFilterId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loadState, setLoadState] = useState<LibraryLoadState>({
    drops: mockLibraryDrops,
    error: null,
    fallbackReason: null,
    source: "mock",
    status: "loading"
  });

  const loadLibraryDrops = useCallback(
    async (isActive: () => boolean = () => true) => {
      setLoadState((currentState) => ({ ...currentState, status: "loading" }));

      const sessionResult = await getAuthSession();
      const userId = sessionResult.data?.user.id;

      if (!userId) {
        if (isActive()) {
          setLoadState({
            drops: mockLibraryDrops,
            error: sessionResult.error,
            fallbackReason: "missing_auth_session",
            source: "mock",
            status: "ready"
          });
        }

        return;
      }

      const result = await fetchLibraryDrops(userId);

      if (isActive()) {
        setLoadState({
          drops: result.data,
          error: result.error,
          fallbackReason: result.fallbackReason,
          source: result.source,
          status: "ready"
        });
      }
    },
    []
  );

  useEffect(() => {
    let isMounted = true;

    void loadLibraryDrops(() => isMounted);

    return () => {
      isMounted = false;
    };
  }, [loadLibraryDrops]);

  const libraryDrops = loadState.drops;
  const libraryItems = useMemo(() => getItemsForDrops(libraryDrops), [libraryDrops]);

  const selectedContentTypes = useMemo(
    () =>
      contentFilters.find((filter) => filter.id === activeContentFilter)
        ?.contentTypes ?? contentFilters[0].contentTypes,
    [activeContentFilter]
  );

  const filteredItems = useMemo(
    () =>
      libraryItems.filter((item) => {
        const matchesContentType = selectedContentTypes.includes(item.content_type);
        const matchesTopic =
          activeTopicFilter === "all" || item.topic === activeTopicFilter;
        const normalizedQuery = searchQuery.trim().toLowerCase();
        const matchesSearch =
          normalizedQuery.length === 0 ||
          item.title.toLowerCase().includes(normalizedQuery) ||
          contentLabels[item.content_type].toLowerCase().includes(normalizedQuery) ||
          (item.topic ? getTopicLabel(item.topic).toLowerCase().includes(normalizedQuery) : false);

        return matchesContentType && matchesTopic && matchesSearch;
      }),
    [activeTopicFilter, libraryItems, searchQuery, selectedContentTypes]
  );

  const filteredDrops = useMemo(() => {
    const matchingDropIds = new Set(filteredItems.map((item) => item.drop_id));

    return libraryDrops.filter((drop) => matchingDropIds.has(drop.drop_id));
  }, [filteredItems, libraryDrops]);

  const itemsByDropId = useMemo(() => {
    return filteredItems.reduce<Record<string, LibraryItemSummary[]>>((itemsByDrop, item) => {
      itemsByDrop[item.drop_id] = [...(itemsByDrop[item.drop_id] ?? []), item];
      return itemsByDrop;
    }, {});
  }, [filteredItems]);

  const savedItems = useMemo(
    () => libraryItems.filter((item) => item.is_saved).slice(0, 3),
    [libraryItems]
  );
  const hasActiveFilters =
    activeContentFilter !== "all" || activeTopicFilter !== "all" || searchQuery.trim().length > 0;

  const clearFilters = () => {
    setActiveContentFilter("all");
    setActiveTopicFilter("all");
    setSearchQuery("");
  };

  return (
    <AppScreen contentStyle={styles.screen}>
      <AppScreen.Header>
        <View style={styles.headerTopline}>
          <AppText variant="eyebrow">Library</AppText>
          <ProgressPill
            label={getDataModeLabel(loadState.source)}
            tone={getDataModeTone(loadState.source)}
          />
        </View>
        <View style={styles.headerCopy}>
          <AppText variant="display">Past drops</AppText>
          <AppText color="muted" variant="body">
            Return to previous daily briefings, saved ideas, and completed practice.
          </AppText>
        </View>
      </AppScreen.Header>

      <AppScreen.Body>
        <LibraryDataStateBanner
          loadState={loadState}
          onRetry={() => {
            void loadLibraryDrops();
          }}
        />

        <Card padding="md" style={styles.controls}>
          <View style={styles.controlsHeader}>
            <View style={styles.controlsCopy}>
              <AppText variant="bodyStrong">Find a past lesson</AppText>
              <AppText color="muted" variant="caption">
                Filter by format, topic, or title. The archive stays finite: past daily drops only.
              </AppText>
            </View>
            {hasActiveFilters ? (
              <SecondaryButton label="Clear" onPress={clearFilters} style={styles.clearButton} />
            ) : null}
          </View>
          <TextInput
            accessibilityLabel="Search library"
            onChangeText={setSearchQuery}
            placeholder="Search archive"
            placeholderTextColor={tokens.color.muted}
            returnKeyType="search"
            style={styles.searchInput}
            value={searchQuery}
          />

          <FilterRail label="Show">
            {contentFilters.map((filter) => (
              <FilterChip
                active={activeContentFilter === filter.id}
                key={filter.id}
                label={filter.label}
                onPress={() => setActiveContentFilter(filter.id)}
              />
            ))}
          </FilterRail>

          <FilterRail label="Topic">
            {topicFilters.map((filter) => (
              <FilterChip
                active={activeTopicFilter === filter.id}
                key={filter.id}
                label={filter.label}
                onPress={() => setActiveTopicFilter(filter.id)}
              />
            ))}
          </FilterRail>
        </Card>

        <SavedItemsPlaceholder savedItems={savedItems} />

        <View style={styles.archiveSection}>
          <SectionHeader
            description={`${filteredItems.length} matching item${
              filteredItems.length === 1 ? "" : "s"
            } across ${filteredDrops.length} daily drop${
              filteredDrops.length === 1 ? "" : "s"
            }.`}
            eyebrow="Archive"
            title="Daily drops by date"
          />

          {filteredDrops.length > 0 ? (
            filteredDrops.map((drop) => (
              <ArchiveDropCard
                drop={drop}
                items={itemsByDropId[drop.drop_id] ?? []}
                key={drop.drop_id}
              />
            ))
          ) : (
            <EmptyState
              actionLabel={hasActiveFilters ? "Clear filters" : undefined}
              description={
                hasActiveFilters
                  ? "Your archive is still here. Clear filters or search for a broader topic."
                  : "Completed and assigned drops will appear here by date after your first live daily drop."
              }
              eyebrow="No results"
              onActionPress={hasActiveFilters ? clearFilters : undefined}
              title="No archived drop matches these filters"
            />
          )}
        </View>
      </AppScreen.Body>
    </AppScreen>
  );
}

function LibraryDataStateBanner({
  loadState,
  onRetry
}: {
  loadState: LibraryLoadState;
  onRetry: () => void;
}) {
  if (loadState.status === "loading") {
    return (
      <DataModeBanner
        description="Looking for assigned past drops. Existing archive content stays visible while the app checks live data."
        mode="checking"
        title="Loading archive"
      />
    );
  }

  if (loadState.source === "supabase") {
    return (
      <DataModeBanner
        description="These archived drops are assigned to this account."
        detail={`${loadState.drops.length} drop${loadState.drops.length === 1 ? "" : "s"}`}
        mode="live"
        title="Live archive"
      />
    );
  }

  if (loadState.source === "cache") {
    return (
      <DataModeBanner
        actionLabel="Retry live archive"
        description="The latest archive check is unavailable, so the app is showing the last archive kept in memory."
        detail={`${loadState.drops.length} drop${loadState.drops.length === 1 ? "" : "s"}`}
        mode="cache"
        onActionPress={onRetry}
        title="Cached archive"
      />
    );
  }

  if (loadState.fallbackReason === "network_unavailable") {
    return (
      <DataModeBanner
        actionLabel="Retry live archive"
        description="The network is unavailable, so the app is showing clearly labeled preview archive content."
        mode="preview"
        onActionPress={onRetry}
        title="You appear to be offline"
      />
    );
  }

  if (loadState.fallbackReason === "supabase_error") {
    return (
      <DataModeBanner
        actionLabel="Retry live archive"
        description={`Live archive could not be reached, so the app is showing a built-in preview archive. ${loadState.error?.message ?? ""}`.trim()}
        mode="preview"
        onActionPress={onRetry}
        title="Preview archive"
      />
    );
  }

  if (loadState.fallbackReason === "missing_supabase_config") {
    return (
      <DataModeBanner
        actionLabel="Retry live archive"
        description="Preview archive content is shown for tester walkthroughs. Developer/Test info: configure the public live-data env vars to load assigned archived drops."
        mode="preview"
        onActionPress={onRetry}
        title="Live Library data is not configured"
      />
    );
  }

  if (loadState.fallbackReason === "no_supabase_data") {
    return (
      <DataModeBanner
        actionLabel="Check again"
        description="No archived daily drops are assigned to this account yet. Preview archive content is shown below."
        mode="preview"
        onActionPress={onRetry}
        title="No live archive yet"
      />
    );
  }

  if (loadState.fallbackReason === "missing_auth_session") {
    return (
      <DataModeBanner
        actionLabel="Retry session check"
        description="Sign in to load your archived daily drops. Preview archive content is shown below."
        mode="preview"
        onActionPress={onRetry}
        title="No active session"
      />
    );
  }

  return null;
}

function getItemsForDrops(drops: LibraryDropSummary[]) {
  return drops.flatMap((drop) => {
    if (drop.items) {
      return drop.items;
    }

    return mockLibraryItems.filter((item) => item.drop_id === drop.drop_id);
  });
}

function getDataModeLabel(source: DataFetchSource) {
  if (source === "supabase") {
    return "Live archive";
  }

  if (source === "cache") {
    return "Cached archive";
  }

  return "Preview archive";
}

function getDataModeTone(source: DataFetchSource): "success" | "warning" | "neutral" {
  if (source === "supabase") {
    return "success";
  }

  if (source === "cache") {
    return "warning";
  }

  return "neutral";
}

type FilterRailProps = {
  label: string;
  children: ReactNode;
};

function FilterRail({ label, children }: FilterRailProps) {
  return (
    <View style={styles.filterRail}>
      <AppText color="muted" variant="caption">
        {label}
      </AppText>
      <View style={styles.filterChips}>{children}</View>
    </View>
  );
}

type FilterChipProps = {
  active: boolean;
  label: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
};

function FilterChip({ active, label, onPress, style }: FilterChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        active ? styles.filterChipActive : null,
        pressed ? styles.filterChipPressed : null,
        style
      ]}
    >
      <AppText
        color={active ? "accentInk" : "inkSoft"}
        numberOfLines={1}
        variant="caption"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

type SavedItemsPlaceholderProps = {
  savedItems: LibraryItemSummary[];
};

function SavedItemsPlaceholder({ savedItems }: SavedItemsPlaceholderProps) {
  return (
    <Card padding="md" tone="muted">
      <SectionHeader
        description="A quiet shelf for the pieces worth revisiting."
        eyebrow="Saved"
        title="Saved items"
      />

      {savedItems.length > 0 ? (
        <View style={styles.savedItems}>
          {savedItems.map((item) => (
            <View key={item.id} style={styles.savedItemRow}>
              <View style={styles.savedItemCopy}>
                <AppText numberOfLines={1} variant="bodyStrong">
                  {item.title}
                </AppText>
                <AppText color="muted" variant="caption">
                  {contentLabels[item.content_type]} / {formatArchiveDate(item.drop_date)}
                </AppText>
              </View>
              <ProgressPill label="Saved" tone="accent" />
            </View>
          ))}
        </View>
      ) : (
        <EmptyState
          description="Saved articles, mini-cases, and concepts will appear here."
          title="Nothing saved yet"
        />
      )}
    </Card>
  );
}

type ArchiveDropCardProps = {
  drop: LibraryDropSummary;
  items: LibraryItemSummary[];
};

function ArchiveDropCard({ drop, items }: ArchiveDropCardProps) {
  const completionValue =
    drop.item_count > 0 ? drop.completed_item_count / drop.item_count : 0;
  const slotCounts = getArchiveSlotCounts(items);

  return (
    <Card elevated padding="md" style={styles.dropCard}>
      <View style={styles.dropHeader}>
        <View style={styles.dropTitleGroup}>
          <AppText color="muted" variant="caption">
            Drop date / {formatArchiveDate(drop.drop_date)} / {drop.language.toUpperCase()}
          </AppText>
          <AppText variant="subtitle">{drop.title}</AppText>
        </View>
        <ProgressPill
          label={`${drop.completed_item_count}/${drop.item_count}`}
          tone={drop.completed_item_count === drop.item_count ? "success" : "warning"}
          value={completionValue}
        />
      </View>

      <View style={styles.topicRow}>
        {drop.topics.map((topic) => (
          <View key={topic} style={styles.topicTag}>
            <AppText color="accentInk" variant="caption">
              {getTopicLabel(topic)}
            </AppText>
          </View>
        ))}
      </View>

      <View style={styles.slotCoverage}>
        {archiveSlots.map((slot) => {
          const count = slotCounts[slot.id] ?? 0;

          return (
            <View key={slot.id} style={styles.slotCoverageItem}>
              <AppText color={count > 0 ? "accentInk" : "muted"} variant="caption">
                {slot.label}
              </AppText>
              <ProgressPill
                label={count > 0 ? `${count}` : "Missing"}
                tone={count > 0 ? "accent" : "neutral"}
              />
            </View>
          );
        })}
      </View>

      <View style={styles.itemList}>
        {items.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <View style={styles.itemCopy}>
              <AppText color="muted" variant="caption">
                {contentLabels[item.content_type]}
                {item.topic ? ` / ${getTopicLabel(item.topic)}` : ""}
              </AppText>
              <AppText numberOfLines={2} variant="bodyStrong">
                {item.title}
              </AppText>
            </View>
            <View style={styles.itemMeta}>
              {item.is_saved ? <ProgressPill label="Saved" tone="accent" /> : null}
              {item.is_completed ? <ProgressPill label="Done" tone="success" /> : null}
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

function getArchiveSlotCounts(items: LibraryItemSummary[]): Partial<Record<ContentFilterId, number>> {
  return items.reduce<Partial<Record<ContentFilterId, number>>>((counts, item) => {
    const slot = archiveSlots.find((candidate) =>
      candidate.contentTypes.includes(item.content_type)
    );

    if (!slot) {
      return counts;
    }

    return {
      ...counts,
      [slot.id]: (counts[slot.id] ?? 0) + 1
    };
  }, {});
}

function getTopicLabel(topic: LibraryItemSummary["topic"]): string {
  if (!topic) {
    return "General";
  }

  if (topic === "career") {
    return "Career";
  }

  return topicLabels[topic];
}

function formatArchiveDate(date: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short"
  }).format(new Date(`${date}T12:00:00Z`));
}

const styles = StyleSheet.create({
  screen: {
    paddingBottom: tokens.space.xxl
  },
  headerTopline: {
    alignItems: "center",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  headerCopy: {
    gap: tokens.space.sm
  },
  controls: {
    gap: tokens.space.lg
  },
  controlsHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  controlsCopy: {
    flex: 1,
    gap: tokens.space.xs
  },
  clearButton: {
    minHeight: 38,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm
  },
  searchInput: {
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.borderStrong,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    color: tokens.color.ink,
    fontSize: tokens.typography.size.body,
    minHeight: 50,
    paddingHorizontal: tokens.space.lg,
    paddingVertical: tokens.space.md
  },
  filterRail: {
    gap: tokens.space.sm
  },
  filterChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm
  },
  filterChip: {
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.pill,
    borderWidth: 1,
    minHeight: 34,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm
  },
  filterChipActive: {
    backgroundColor: tokens.color.accentSoft,
    borderColor: tokens.color.accent
  },
  filterChipPressed: {
    backgroundColor: tokens.color.surfaceMuted
  },
  savedItems: {
    gap: tokens.space.sm
  },
  savedItemRow: {
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between",
    padding: tokens.space.md
  },
  savedItemCopy: {
    flex: 1,
    gap: tokens.space.xs
  },
  archiveSection: {
    gap: tokens.space.md
  },
  dropCard: {
    gap: tokens.space.lg
  },
  dropHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  dropTitleGroup: {
    flex: 1,
    gap: tokens.space.xs
  },
  topicRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm
  },
  topicTag: {
    backgroundColor: tokens.color.accentSoft,
    borderRadius: tokens.radius.pill,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs
  },
  slotCoverage: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: tokens.space.sm
  },
  slotCoverageItem: {
    backgroundColor: tokens.color.backgroundRaised,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    gap: tokens.space.xs,
    minWidth: 132,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.sm
  },
  itemList: {
    borderTopColor: tokens.color.border,
    borderTopWidth: 1,
    gap: tokens.space.md,
    paddingTop: tokens.space.md
  },
  itemRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: tokens.space.md,
    justifyContent: "space-between"
  },
  itemCopy: {
    flex: 1,
    gap: tokens.space.xs
  },
  itemMeta: {
    alignItems: "flex-end",
    gap: tokens.space.xs
  }
});
