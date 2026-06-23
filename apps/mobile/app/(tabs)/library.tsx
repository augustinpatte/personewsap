import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle
} from "react-native";

import { AppScreen, AppText, EmptyState } from "../../src/components";
import { tokens } from "../../src/design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../src/design/theme";
import { useAuth } from "../../src/features/auth";
import { fetchLibraryDrops, type LibraryDropSummary, type LibraryItemSummary } from "../../src/features/library";
import type { ContentType } from "../../src/features/today";
import { trackAnalyticsEvent } from "../../src/lib/analytics";
import type { DataFallbackReason, DataFetchSource } from "../../src/lib/dataState";
import { localized } from "../../src/lib/i18n";
import { getAuthSession, type NormalizedSupabaseError } from "../../src/lib/supabase";
import { mockLibraryDrops, mockLibraryItems } from "../../src/mocks";
import type { Language } from "../../src/types/domain";

type ContentFilterId = "all" | "newsletter" | "business_story" | "mini_case" | "concept";
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
  contentTypes: ContentType[];
}> = [
  {
    id: "all",
    contentTypes: [
      "newsletter_article",
      "business_story",
      "mini_case",
      "key_concept"
    ]
  },
  { id: "newsletter", contentTypes: ["newsletter_article"] },
  { id: "business_story", contentTypes: ["business_story"] },
  { id: "mini_case", contentTypes: ["mini_case"] },
  { id: "concept", contentTypes: ["key_concept"] }
];

export default function LibraryScreen() {
  const { profileLanguage } = useAuth();
  const [activeContentFilter, setActiveContentFilter] =
    useState<ContentFilterId>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loadState, setLoadState] = useState<LibraryLoadState>({
    drops: mockLibraryDrops,
    error: null,
    fallbackReason: null,
    source: "mock",
    status: "loading"
  });
  const uiLanguage = profileLanguage ?? loadState.drops[0]?.language ?? "en";
  const copy = getLibraryCopy(uiLanguage);
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);

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

  useEffect(() => {
    if (loadState.status === "ready" && loadState.error) {
      trackAnalyticsEvent("error_viewed");
    }
  }, [loadState.error, loadState.status]);

  const libraryDrops = loadState.drops;
  const libraryItems = useMemo(() => getItemsForDrops(libraryDrops), [libraryDrops]);

  const stats = useMemo(() => {
    const completed = libraryItems.filter((item) => item.is_completed);

    return {
      editions: libraryDrops.length,
      readings: completed.filter((item) => item.content_type !== "mini_case").length,
      cases: completed.filter((item) => item.content_type === "mini_case").length
    };
  }, [libraryDrops, libraryItems]);

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
        const normalizedQuery = searchQuery.trim().toLowerCase();
        const matchesSearch =
          normalizedQuery.length === 0 ||
          item.title.toLowerCase().includes(normalizedQuery) ||
          getContentTypeLabel(item.content_type, uiLanguage).toLowerCase().includes(normalizedQuery) ||
          (item.topic ? getTopicLabel(item.topic, uiLanguage).toLowerCase().includes(normalizedQuery) : false);

        return matchesContentType && matchesSearch;
      }),
    [libraryItems, searchQuery, selectedContentTypes, uiLanguage]
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
    () => libraryItems.filter((item) => item.is_saved).slice(0, 4),
    [libraryItems]
  );
  const hasActiveFilters =
    activeContentFilter !== "all" || searchQuery.trim().length > 0;

  const clearFilters = () => {
    setActiveContentFilter("all");
    setSearchQuery("");
  };

  return (
    <AppScreen contentStyle={styles.screen}>
      <AppScreen.Header>
        <View style={styles.headerCopy}>
          <AppText color="muted" variant="eyebrow">
            {copy.eyebrow}
          </AppText>
          <AppText variant="display">{copy.title}</AppText>
          <AppText color="muted" variant="body">
            {copy.description}
          </AppText>
        </View>
      </AppScreen.Header>

      <AppScreen.Body>
        <View style={styles.statStrip}>
          <Stat label={copy.statEditions} value={stats.editions} />
          <View style={styles.statDivider} />
          <Stat label={copy.statReadings} value={stats.readings} />
          <View style={styles.statDivider} />
          <Stat label={copy.statCases} value={stats.cases} />
        </View>

        {savedItems.length > 0 ? (
          <View style={styles.shelf}>
            <AppText color="muted" variant="eyebrow">
              {copy.savedEyebrow}
            </AppText>
            <View style={styles.shelfList}>
              {savedItems.map((item) => (
                <View key={item.id} style={styles.shelfRow}>
                  <AppText numberOfLines={1} variant="bodyStrong">
                    {item.title}
                  </AppText>
                  <AppText color="muted" variant="caption">
                    {getContentTypeLabel(item.content_type, uiLanguage)}
                  </AppText>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.controls}>
          <TextInput
            accessibilityLabel={copy.searchAccessibility}
            onChangeText={setSearchQuery}
            placeholder={copy.searchPlaceholder}
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={styles.searchInput}
            value={searchQuery}
          />
          <View style={styles.filterChips}>
            {contentFilters.map((filter) => (
              <FilterChip
                active={activeContentFilter === filter.id}
                key={filter.id}
                label={copy.contentFilters[filter.id]}
                onPress={() => setActiveContentFilter(filter.id)}
              />
            ))}
          </View>
        </View>

        <View style={styles.archiveSection}>
          {filteredDrops.length > 0 ? (
            filteredDrops.map((drop) => (
              <ArchiveDropGroup
                drop={drop}
                items={itemsByDropId[drop.drop_id] ?? []}
                key={drop.drop_id}
                language={uiLanguage}
              />
            ))
          ) : (
            <EmptyState
              actionLabel={hasActiveFilters ? copy.clearFilters : undefined}
              description={
                hasActiveFilters
                  ? copy.filteredEmptyDescription
                  : copy.archiveEmptyDescription
              }
              eyebrow={hasActiveFilters ? copy.noResultsEyebrow : undefined}
              onActionPress={hasActiveFilters ? clearFilters : undefined}
              title={hasActiveFilters ? copy.filteredEmptyTitle : copy.archiveEmptyTitle}
            />
          )}
        </View>
      </AppScreen.Body>
    </AppScreen>
  );
}

function getItemsForDrops(drops: LibraryDropSummary[]) {
  return drops.flatMap((drop) => {
    if (drop.items) {
      return drop.items;
    }

    return mockLibraryItems.filter((item) => item.drop_id === drop.drop_id);
  });
}

function Stat({ label, value }: { label: string; value: number }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.stat}>
      <AppText variant="title">{value}</AppText>
      <AppText color="muted" variant="eyebrow">
        {label}
      </AppText>
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
  const styles = useThemedStyles(createStyles);
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

type ArchiveDropGroupProps = {
  drop: LibraryDropSummary;
  items: LibraryItemSummary[];
  language: Language;
};

function ArchiveDropGroup({ drop, items, language }: ArchiveDropGroupProps) {
  const styles = useThemedStyles(createStyles);
  const topicLine = drop.topics
    .map((topic) => getTopicLabel(topic, language))
    .join(" · ");

  return (
    <View style={styles.dropGroup}>
      <View style={styles.dropHeader}>
        <AppText color="muted" variant="eyebrow">
          {formatArchiveDate(drop.drop_date, language)}
        </AppText>
        <AppText variant="subtitle">{drop.title}</AppText>
        {topicLine.length > 0 ? (
          <AppText color="muted" variant="caption">
            {topicLine}
          </AppText>
        ) : null}
      </View>

      <View style={styles.itemList}>
        {items.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <View
              style={[
                styles.itemDot,
                item.is_completed ? styles.itemDotComplete : null
              ]}
            />
            <View style={styles.itemCopy}>
              <AppText numberOfLines={2} variant="body">
                {item.title}
              </AppText>
              <AppText color="muted" variant="caption">
                {getContentTypeLabel(item.content_type, language)}
                {item.topic ? ` · ${getTopicLabel(item.topic, language)}` : ""}
              </AppText>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function getContentTypeLabel(contentType: ContentType, language: Language) {
  return getLibraryCopy(language).contentTypes[contentType];
}

function getTopicLabel(topic: LibraryItemSummary["topic"] | LibraryDropSummary["topics"][number], language: Language): string {
  const copy = getLibraryCopy(language);

  if (!topic) {
    return copy.generalTopic;
  }

  if (topic === "career") {
    return copy.careerTopic;
  }

  return copy.topics[topic];
}

function formatArchiveDate(date: string, language: Language): string {
  return new Intl.DateTimeFormat(language, {
    day: "numeric",
    month: "long"
  }).format(new Date(`${date}T12:00:00Z`));
}

function getLibraryCopy(language: Language) {
  return localized(
    {
      en: {
        archiveEmptyDescription:
          "Each daily brief you read settles here, so you can return to it whenever you like.",
        archiveEmptyTitle: "Your shelf is still filling",
        careerTopic: "Career",
        clearFilters: "Clear filters",
        contentFilters: {
          all: "All",
          newsletter: "Newsletter",
          business_story: "Business story",
          mini_case: "Mini-case",
          concept: "Concept"
        },
        contentTypes: {
          newsletter_article: "Newsletter",
          business_story: "Business story",
          mini_case: "Mini-case",
          key_concept: "Concept"
        },
        description: "Everything you've read and worked through, kept in one quiet place.",
        eyebrow: "Your library",
        filteredEmptyDescription:
          "Nothing matches that just yet. Clear the filters to see everything again.",
        filteredEmptyTitle: "No match",
        generalTopic: "General",
        noResultsEyebrow: "No results",
        savedEyebrow: "Worth revisiting",
        searchAccessibility: "Search your library",
        searchPlaceholder: "Search",
        statCases: "Cases",
        statEditions: "Editions",
        statReadings: "Readings",
        title: "What you've learned",
        topics: {
          business: "Stock Market",
          finance: "Finance & Economy",
          tech_ai: "Artificial Intelligence",
          law: "Law",
          medicine: "Health",
          engineering: "Engineering",
          sport_business: "Sport",
          culture_media: "Culture"
        }
      },
      fr: {
        archiveEmptyDescription:
          "Chaque brief que vous lisez se range ici, pour y revenir quand vous le souhaitez.",
        archiveEmptyTitle: "Votre bibliothèque se remplit",
        careerTopic: "Carrière",
        clearFilters: "Effacer les filtres",
        contentFilters: {
          all: "Tout",
          newsletter: "Newsletter",
          business_story: "Histoire business",
          mini_case: "Mini-cas",
          concept: "Concept"
        },
        contentTypes: {
          newsletter_article: "Newsletter",
          business_story: "Histoire business",
          mini_case: "Mini-cas",
          key_concept: "Concept"
        },
        description: "Tout ce que vous avez lu et travaillé, réuni dans un même endroit calme.",
        eyebrow: "Votre bibliothèque",
        filteredEmptyDescription:
          "Rien ne correspond pour l'instant. Effacez les filtres pour tout revoir.",
        filteredEmptyTitle: "Aucun résultat",
        generalTopic: "Général",
        noResultsEyebrow: "Aucun résultat",
        savedEyebrow: "À revoir",
        searchAccessibility: "Rechercher dans la bibliothèque",
        searchPlaceholder: "Rechercher",
        statCases: "Cas",
        statEditions: "Éditions",
        statReadings: "Lectures",
        title: "Ce que vous avez appris",
        topics: {
          business: "Marché actions",
          finance: "Finance & économie",
          tech_ai: "Intelligence artificielle",
          law: "Droit",
          medicine: "Santé",
          engineering: "Ingénierie",
          sport_business: "Sport",
          culture_media: "Culture"
        }
      }
    },
    language
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    screen: {
      paddingBottom: tokens.space.xxl
    },
    headerCopy: {
      gap: tokens.space.sm
    },
    statStrip: {
      alignItems: "center",
      flexDirection: "row"
    },
    stat: {
      alignItems: "center",
      flex: 1,
      gap: tokens.space.xs
    },
    statDivider: {
      backgroundColor: c.border,
      height: 40,
      width: 1
    },
    shelf: {
      gap: tokens.space.md
    },
    shelfList: {
      gap: tokens.space.sm
    },
    shelfRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: tokens.space.md,
      justifyContent: "space-between"
    },
    controls: {
      gap: tokens.space.md
    },
    searchInput: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      color: c.ink,
      fontSize: tokens.typography.size.body,
      minHeight: 50,
      paddingHorizontal: tokens.space.lg,
      paddingVertical: tokens.space.md
    },
    filterChips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.space.sm
    },
    filterChip: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: tokens.radius.pill,
      borderWidth: 1,
      minHeight: 40,
      paddingHorizontal: tokens.space.md,
      paddingVertical: tokens.space.sm
    },
    filterChipActive: {
      backgroundColor: c.accentSoft,
      borderColor: c.accent
    },
    filterChipPressed: {
      backgroundColor: c.surfaceMuted
    },
    archiveSection: {
      gap: tokens.space.xl
    },
    dropGroup: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.lg,
      paddingTop: tokens.space.lg
    },
    dropHeader: {
      gap: tokens.space.xs
    },
    itemList: {
      gap: tokens.space.lg
    },
    itemRow: {
      flexDirection: "row",
      gap: tokens.space.md
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
    itemDotComplete: {
      backgroundColor: c.accent,
      borderColor: c.accent
    },
    itemCopy: {
      flex: 1,
      gap: tokens.space.xs
    }
  });
