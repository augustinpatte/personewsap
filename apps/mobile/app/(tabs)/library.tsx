import { useMemo, useState, type ReactNode } from "react";
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
  EmptyState,
  ProgressPill,
  SectionHeader
} from "../../src/components";
import { tokens } from "../../src/design/tokens";
import type { LibraryDropSummary, LibraryItemSummary } from "../../src/features/library";
import type { ContentType } from "../../src/features/today";
import { mockLibraryDrops, mockLibraryItems } from "../../src/mocks";

type ContentFilterId = "all" | "newsletter" | "business_story" | "mini_case" | "concept";
type TopicFilterId = "all" | TopicId;

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

const topicLabels = TOPICS.reduce<Record<TopicId, string>>((labels, topic) => {
  labels[topic.id] = topic.label;
  return labels;
}, {} as Record<TopicId, string>);

export default function LibraryScreen() {
  const [activeContentFilter, setActiveContentFilter] =
    useState<ContentFilterId>("all");
  const [activeTopicFilter, setActiveTopicFilter] = useState<TopicFilterId>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const selectedContentTypes = useMemo(
    () =>
      contentFilters.find((filter) => filter.id === activeContentFilter)
        ?.contentTypes ?? contentFilters[0].contentTypes,
    [activeContentFilter]
  );

  const filteredItems = useMemo(
    () =>
      mockLibraryItems.filter((item) => {
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
    [activeTopicFilter, searchQuery, selectedContentTypes]
  );

  const filteredDrops = useMemo(() => {
    const matchingDropIds = new Set(filteredItems.map((item) => item.drop_id));

    return mockLibraryDrops.filter((drop) => matchingDropIds.has(drop.drop_id));
  }, [filteredItems]);

  const itemsByDropId = useMemo(() => {
    return filteredItems.reduce<Record<string, LibraryItemSummary[]>>((itemsByDrop, item) => {
      itemsByDrop[item.drop_id] = [...(itemsByDrop[item.drop_id] ?? []), item];
      return itemsByDrop;
    }, {});
  }, [filteredItems]);

  const savedItems = useMemo(
    () => mockLibraryItems.filter((item) => item.is_saved).slice(0, 3),
    []
  );

  return (
    <AppScreen contentStyle={styles.screen}>
      <AppScreen.Header>
        <AppText variant="eyebrow">Library</AppText>
        <AppText variant="display">Past drops</AppText>
        <AppText color="muted" variant="body">
          Return to previous daily briefings, saved ideas, and completed practice.
        </AppText>
      </AppScreen.Header>

      <AppScreen.Body>
        <Card padding="md" style={styles.controls}>
          <TextInput
            accessibilityLabel="Search library"
            onChangeText={setSearchQuery}
            placeholder="Search archive"
            placeholderTextColor={tokens.color.muted}
            returnKeyType="search"
            style={styles.searchInput}
            value={searchQuery}
          />

          <FilterRail label="Type">
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
            title="Daily drops"
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
              description="Try a different content type, topic, or search term."
              eyebrow="No results"
              title="No archived drop matches these filters"
            />
          )}
        </View>
      </AppScreen.Body>
    </AppScreen>
  );
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

  return (
    <Card elevated padding="md" style={styles.dropCard}>
      <View style={styles.dropHeader}>
        <View style={styles.dropTitleGroup}>
          <AppText color="muted" variant="caption">
            {formatArchiveDate(drop.drop_date)} / {drop.language.toUpperCase()}
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
  controls: {
    gap: tokens.space.lg
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
