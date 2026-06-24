import { useLocalSearchParams, useRouter, type Href } from "expo-router";
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
import {
  fetchLibraryDrops,
  fetchProfileCreatedAt,
  unlockedEditionCount,
  type LibraryDropSummary,
  type LibraryItemSummary
} from "../../src/features/library";
import type { ContentType } from "../../src/features/today";
import { resolveEditionType } from "../../src/features/today/editionCadence";
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
  createdAt: string | null;
  error: NormalizedSupabaseError | null;
  fallbackReason: LibraryFallbackReason | null;
  source: DataFetchSource;
  status: "loading" | "ready";
};

type LibrarySectionId = "newsletter" | "weekly_digest";

type EditionEntry = {
  drop: LibraryDropSummary;
  locked: boolean;
  items: LibraryItemSummary[];
};

// Only the Sunday edition is a Weekly Digest; everything else is a regular
// newsletter edition. Derived from the drop date so no schema field is needed.
function sectionForDrop(drop: LibraryDropSummary): LibrarySectionId {
  return resolveEditionType(drop.drop_date) === "weekly_digest"
    ? "weekly_digest"
    : "newsletter";
}

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

function isContentFilterId(value: unknown): value is ContentFilterId {
  return (
    typeof value === "string" &&
    contentFilters.some((filter) => filter.id === value)
  );
}

type ReaderKind = "newsletter" | "story" | "mini-case" | "concept";

const readerKindByContentType: Record<ContentType, ReaderKind> = {
  newsletter_article: "newsletter",
  business_story: "story",
  mini_case: "mini-case",
  key_concept: "concept"
};

// expo-router's generated types lag behind the reader route files, so we build
// the href once and keep the call sites typed.
function readerHref(contentType: ContentType, id: string): Href {
  const kind = readerKindByContentType[contentType];
  return { pathname: `/(reader)/${kind}/[id]`, params: { id } } as unknown as Href;
}

function openLibraryItem(router: ReturnType<typeof useRouter>, item: LibraryItemSummary) {
  trackAnalyticsEvent("content_item_opened", {
    content_type: item.content_type,
    drop_date: item.drop_date,
    item_id: item.id
  });
  router.push(readerHref(item.content_type, item.id));
}

export default function LibraryScreen() {
  const { profileLanguage } = useAuth();
  const { filter } = useLocalSearchParams<{ filter?: string }>();
  const [activeContentFilter, setActiveContentFilter] =
    useState<ContentFilterId>(isContentFilterId(filter) ? filter : "all");
  const [searchQuery, setSearchQuery] = useState("");
  const [loadState, setLoadState] = useState<LibraryLoadState>({
    drops: mockLibraryDrops,
    createdAt: null,
    error: null,
    fallbackReason: null,
    source: "mock",
    status: "loading"
  });
  // Language is the single source of truth (profiles.language via AuthProvider).
  // The library must read and reload in this language so it never lists or opens
  // content in the previous language after a switch.
  const activeLanguage: Language = profileLanguage ?? "en";
  const uiLanguage = activeLanguage;
  const copy = getLibraryCopy(uiLanguage);
  const colors = useThemeColors();
  const styles = useThemedStyles(createStyles);
  const router = useRouter();

  const loadLibraryDrops = useCallback(
    async (isActive: () => boolean = () => true) => {
      setLoadState((currentState) => ({ ...currentState, status: "loading" }));

      const sessionResult = await getAuthSession();
      const userId = sessionResult.data?.user.id;

      if (!userId) {
        if (isActive()) {
          setLoadState({
            drops: mockLibraryDrops,
            createdAt: null,
            error: sessionResult.error,
            fallbackReason: "missing_auth_session",
            source: "mock",
            status: "ready"
          });
        }

        return;
      }

      const [result, createdAt] = await Promise.all([
        fetchLibraryDrops(userId, { language: activeLanguage }),
        fetchProfileCreatedAt(userId)
      ]);

      if (isActive()) {
        setLoadState({
          drops: result.data,
          createdAt,
          error: result.error,
          fallbackReason: result.fallbackReason,
          source: result.source,
          status: "ready"
        });
      }
    },
    [activeLanguage]
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

  useEffect(() => {
    if (isContentFilterId(filter)) {
      setActiveContentFilter(filter);
    }
  }, [filter]);

  const libraryDrops = loadState.drops;
  const libraryItems = useMemo(() => getItemsForDrops(libraryDrops), [libraryDrops]);

  // Access gate: the most recent editions stay readable, older ones lock until
  // tenure widens the window. Ranked over all editions so the gate is stable
  // regardless of the active content filter.
  const lockedDropIds = useMemo(() => {
    const sorted = [...libraryDrops].sort((left, right) =>
      right.drop_date.localeCompare(left.drop_date)
    );
    const unlocked = unlockedEditionCount(loadState.createdAt);
    const locked = new Set<string>();

    sorted.forEach((drop, rank) => {
      if (rank >= unlocked) {
        locked.add(drop.drop_id);
      }
    });

    return locked;
  }, [libraryDrops, loadState.createdAt]);

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

  // Saved shelf never surfaces a locked edition, so a shortcut can't bypass the gate.
  const savedItems = useMemo(
    () =>
      libraryItems
        .filter((item) => item.is_saved && !lockedDropIds.has(item.drop_id))
        .slice(0, 4),
    [libraryItems, lockedDropIds]
  );
  const hasActiveFilters =
    activeContentFilter !== "all" || searchQuery.trim().length > 0;

  // Locked editions are listed (title + date) only in the default browse view;
  // they hold no openable items to filter or search.
  const sections = useMemo(() => {
    const unlockedEntries: EditionEntry[] = filteredDrops
      .filter((drop) => !lockedDropIds.has(drop.drop_id))
      .map((drop) => ({ drop, locked: false, items: itemsByDropId[drop.drop_id] ?? [] }));

    const lockedEntries: EditionEntry[] = hasActiveFilters
      ? []
      : libraryDrops
          .filter((drop) => lockedDropIds.has(drop.drop_id))
          .map((drop) => ({ drop, locked: true, items: [] }));

    const bySection: Record<LibrarySectionId, EditionEntry[]> = {
      newsletter: [],
      weekly_digest: []
    };

    for (const entry of [...unlockedEntries, ...lockedEntries]) {
      bySection[sectionForDrop(entry.drop)].push(entry);
    }

    const orderedSectionIds: LibrarySectionId[] = ["newsletter", "weekly_digest"];

    for (const sectionId of orderedSectionIds) {
      bySection[sectionId].sort((left, right) =>
        right.drop.drop_date.localeCompare(left.drop.drop_date)
      );
    }

    return orderedSectionIds
      .map((id) => ({ id, entries: bySection[id] }))
      .filter((section) => section.entries.length > 0);
  }, [filteredDrops, hasActiveFilters, itemsByDropId, libraryDrops, lockedDropIds]);

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
                <Pressable
                  accessibilityHint={copy.openHint}
                  accessibilityRole="button"
                  key={item.id}
                  onPress={() => openLibraryItem(router, item)}
                  style={({ pressed }) => [
                    styles.shelfRow,
                    pressed ? styles.itemRowPressed : null
                  ]}
                >
                  <AppText numberOfLines={1} style={styles.shelfRowTitle} variant="bodyStrong">
                    {item.title}
                  </AppText>
                  <AppText color="muted" variant="caption">
                    {getContentTypeLabel(item.content_type, uiLanguage)}
                  </AppText>
                </Pressable>
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
          {sections.length > 0 ? (
            sections.map((section) => (
              <View key={section.id} style={styles.section}>
                <AppText color="muted" variant="eyebrow">
                  {copy.sections[section.id]}
                </AppText>
                {section.entries.map((entry) =>
                  entry.locked ? (
                    <LockedEditionGroup
                      drop={entry.drop}
                      key={entry.drop.drop_id}
                      language={uiLanguage}
                    />
                  ) : (
                    <ArchiveDropGroup
                      drop={entry.drop}
                      items={entry.items}
                      key={entry.drop.drop_id}
                      language={uiLanguage}
                    />
                  )
                )}
              </View>
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
  const router = useRouter();
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
          <Pressable
            accessibilityHint={getLibraryCopy(language).openHint}
            accessibilityRole="button"
            key={item.id}
            onPress={() => openLibraryItem(router, item)}
            style={({ pressed }) => [styles.itemRow, pressed ? styles.itemRowPressed : null]}
          >
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
            <AppText color="accentInk" style={styles.itemArrow} variant="label">
              →
            </AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function LockedEditionGroup({
  drop,
  language
}: {
  drop: LibraryDropSummary;
  language: Language;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getLibraryCopy(language);

  return (
    <View
      accessibilityLabel={`${drop.title} — ${copy.lockedAvailability}`}
      style={[styles.dropGroup, styles.lockedGroup]}
    >
      <View style={styles.dropHeader}>
        <AppText color="muted" variant="eyebrow">
          {formatArchiveDate(drop.drop_date, language)}
        </AppText>
        <AppText color="muted" variant="subtitle">
          {drop.title}
        </AppText>
      </View>
      <View style={styles.lockedRow}>
        <View style={styles.lockedBadge}>
          <AppText color="muted" variant="caption">
            {copy.lockedAvailability}
          </AppText>
        </View>
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
        lockedAvailability: "Available after a few days of use.",
        noResultsEyebrow: "No results",
        openHint: "Opens this reading",
        savedEyebrow: "Worth revisiting",
        sections: {
          newsletter: "Newsletters",
          weekly_digest: "Weekly Digests"
        },
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
        lockedAvailability: "Disponible après quelques jours d'utilisation.",
        noResultsEyebrow: "Aucun résultat",
        openHint: "Ouvre cette lecture",
        savedEyebrow: "À revoir",
        sections: {
          newsletter: "Newsletters",
          weekly_digest: "Weekly Digests"
        },
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
      justifyContent: "space-between",
      minHeight: 44
    },
    shelfRowTitle: {
      flexShrink: 1
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
      gap: tokens.space.xxl
    },
    section: {
      gap: tokens.space.lg
    },
    dropGroup: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.lg,
      paddingTop: tokens.space.lg
    },
    lockedGroup: {
      gap: tokens.space.md
    },
    lockedRow: {
      flexDirection: "row"
    },
    lockedBadge: {
      backgroundColor: c.surfaceMuted,
      borderColor: c.border,
      borderRadius: tokens.radius.pill,
      borderWidth: 1,
      paddingHorizontal: tokens.space.md,
      paddingVertical: tokens.space.xs
    },
    dropHeader: {
      gap: tokens.space.xs
    },
    itemList: {
      gap: tokens.space.lg
    },
    itemRow: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: tokens.space.md,
      minHeight: 44
    },
    itemRowPressed: {
      opacity: 0.6
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
    },
    itemArrow: {
      marginTop: 2
    }
  });
