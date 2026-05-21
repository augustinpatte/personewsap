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
import { useAuth } from "../../src/features/auth";
import { fetchLibraryDrops, type LibraryDropSummary, type LibraryItemSummary } from "../../src/features/library";
import type { ContentType } from "../../src/features/today";
import { trackAnalyticsEvent } from "../../src/lib/analytics";
import type { DataFallbackReason, DataFetchSource } from "../../src/lib/dataState";
import { localized } from "../../src/lib/i18n";
import { getAuthSession, type NormalizedSupabaseError } from "../../src/lib/supabase";
import { getUserFacingError } from "../../src/lib/userFacingErrors";
import { mockLibraryDrops, mockLibraryItems } from "../../src/mocks";
import type { Language } from "../../src/types/domain";

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

const topicFilterIds: TopicFilterId[] = ["all", ...TOPICS.map((topic) => topic.id)];

const archiveSlots: Array<{
  id: ContentFilterId;
  contentTypes: ContentType[];
}> = [
  { id: "newsletter", contentTypes: ["newsletter_article"] },
  { id: "business_story", contentTypes: ["business_story"] },
  { id: "mini_case", contentTypes: ["mini_case"] },
  { id: "concept", contentTypes: ["key_concept"] }
];

export default function LibraryScreen() {
  const { profileLanguage } = useAuth();
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
  const uiLanguage = profileLanguage ?? loadState.drops[0]?.language ?? "en";
  const copy = getLibraryCopy(uiLanguage);

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
          getContentTypeLabel(item.content_type, uiLanguage).toLowerCase().includes(normalizedQuery) ||
          (item.topic ? getTopicLabel(item.topic, uiLanguage).toLowerCase().includes(normalizedQuery) : false);

        return matchesContentType && matchesTopic && matchesSearch;
      }),
    [activeTopicFilter, libraryItems, searchQuery, selectedContentTypes, uiLanguage]
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
          <AppText variant="eyebrow">{copy.eyebrow}</AppText>
          <ProgressPill
            label={getDataModeLabel(loadState.source, uiLanguage)}
            tone={getDataModeTone(loadState.source)}
          />
        </View>
        <View style={styles.headerCopy}>
          <AppText variant="display">{copy.title}</AppText>
          <AppText color="muted" variant="body">
            {copy.description}
          </AppText>
        </View>
      </AppScreen.Header>

      <AppScreen.Body>
        <LibraryDataStateBanner
          language={uiLanguage}
          loadState={loadState}
          onRetry={() => {
            void loadLibraryDrops();
          }}
        />

        <Card padding="md" style={styles.controls}>
          <View style={styles.controlsHeader}>
            <View style={styles.controlsCopy}>
              <AppText variant="bodyStrong">{copy.findTitle}</AppText>
              <AppText color="muted" variant="caption">
                {copy.findDescription}
              </AppText>
            </View>
            {hasActiveFilters ? (
              <SecondaryButton label={copy.clear} onPress={clearFilters} style={styles.clearButton} />
            ) : null}
          </View>
          <TextInput
            accessibilityLabel={copy.searchAccessibility}
            onChangeText={setSearchQuery}
            placeholder={copy.searchPlaceholder}
            placeholderTextColor={tokens.color.muted}
            returnKeyType="search"
            style={styles.searchInput}
            value={searchQuery}
          />

          <FilterRail label={copy.showFilter}>
            {contentFilters.map((filter) => (
              <FilterChip
                active={activeContentFilter === filter.id}
                key={filter.id}
                label={copy.contentFilters[filter.id]}
                onPress={() => setActiveContentFilter(filter.id)}
              />
            ))}
          </FilterRail>

          <FilterRail label={copy.topicFilter}>
            {topicFilterIds.map((filterId) => (
              <FilterChip
                active={activeTopicFilter === filterId}
                key={filterId}
                label={filterId === "all" ? copy.allTopics : getTopicLabel(filterId, uiLanguage)}
                onPress={() => setActiveTopicFilter(filterId)}
              />
            ))}
          </FilterRail>
        </Card>

        <SavedItemsPlaceholder language={uiLanguage} savedItems={savedItems} />

        <View style={styles.archiveSection}>
          <SectionHeader
            description={copy.matchingSummary(filteredItems.length, filteredDrops.length)}
            eyebrow={copy.archiveEyebrow}
            title={copy.archiveTitle}
          />

          {filteredDrops.length > 0 ? (
            filteredDrops.map((drop) => (
              <ArchiveDropCard
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
              eyebrow={copy.noResultsEyebrow}
              onActionPress={hasActiveFilters ? clearFilters : undefined}
              title={copy.filteredEmptyTitle}
            />
          )}
        </View>
      </AppScreen.Body>
    </AppScreen>
  );
}

function LibraryDataStateBanner({
  language,
  loadState,
  onRetry
}: {
  language: Language;
  loadState: LibraryLoadState;
  onRetry: () => void;
}) {
  const copy = getLibraryCopy(language);

  if (loadState.status === "loading") {
    return (
      <DataModeBanner
        description={copy.loadingDescription}
        mode="checking"
        title={copy.loadingTitle}
      />
    );
  }

  if (loadState.source === "supabase") {
    return (
      <DataModeBanner
        description={copy.liveArchiveDescription}
        detail={copy.dropCount(loadState.drops.length)}
        mode="live"
        title={copy.liveArchiveTitle}
      />
    );
  }

  if (loadState.source === "cache") {
    return (
      <DataModeBanner
        actionLabel={copy.retryLiveArchive}
        description={copy.cachedArchiveDescription}
        detail={copy.dropCount(loadState.drops.length)}
        mode="cache"
        onActionPress={onRetry}
        title={copy.cachedArchiveTitle}
      />
    );
  }

  if (loadState.fallbackReason === "network_unavailable") {
    const userFacingError = getUserFacingError(
      loadState.error,
      language,
      "library"
    );

    return (
      <DataModeBanner
        actionLabel={copy.retryLiveArchive}
        description={`${userFacingError.message} ${copy.previewArchiveFallback}`}
        mode="preview"
        onActionPress={onRetry}
        title={userFacingError.title}
      />
    );
  }

  if (loadState.fallbackReason === "supabase_error") {
    const userFacingError = getUserFacingError(
      loadState.error,
      language,
      "library"
    );

    return (
      <DataModeBanner
        actionLabel={copy.retryLiveArchive}
        description={`${userFacingError.message} ${copy.previewArchiveFallback}`}
        mode="preview"
        onActionPress={onRetry}
        title={userFacingError.title}
      />
    );
  }

  if (loadState.fallbackReason === "missing_supabase_config") {
    const userFacingError = getUserFacingError(
      loadState.error,
      language,
      "library"
    );

    return (
      <DataModeBanner
        actionLabel={copy.retryLiveArchive}
        description={`${userFacingError.message} ${copy.previewArchiveFallback}`}
        mode="preview"
        onActionPress={onRetry}
        title={userFacingError.title}
      />
    );
  }

  if (loadState.fallbackReason === "no_supabase_data") {
    return (
      <DataModeBanner
        actionLabel={copy.checkAgain}
        description={copy.noLiveArchiveDescription}
        mode="preview"
        onActionPress={onRetry}
        title={copy.noLiveArchiveTitle}
      />
    );
  }

  if (loadState.fallbackReason === "missing_auth_session") {
    return (
      <DataModeBanner
        actionLabel={copy.retrySessionCheck}
        description={copy.noSessionDescription}
        mode="preview"
        onActionPress={onRetry}
        title={copy.noSessionTitle}
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

function getDataModeLabel(source: DataFetchSource, language: Language) {
  const copy = getLibraryCopy(language);

  if (source === "supabase") {
    return copy.liveArchiveTitle;
  }

  if (source === "cache") {
    return copy.cachedArchiveTitle;
  }

  return copy.previewArchiveTitle;
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
  language: Language;
  savedItems: LibraryItemSummary[];
};

function SavedItemsPlaceholder({ language, savedItems }: SavedItemsPlaceholderProps) {
  const copy = getLibraryCopy(language);

  return (
    <Card padding="md" tone="muted">
      <SectionHeader
        description={copy.savedDescription}
        eyebrow={copy.savedEyebrow}
        title={copy.savedTitle}
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
                  {getContentTypeLabel(item.content_type, language)} / {formatArchiveDate(item.drop_date, language)}
                </AppText>
              </View>
              <ProgressPill label={copy.savedPill} tone="accent" />
            </View>
          ))}
        </View>
      ) : (
        <EmptyState
          description={copy.savedEmptyDescription}
          title={copy.savedEmptyTitle}
        />
      )}
    </Card>
  );
}

type ArchiveDropCardProps = {
  drop: LibraryDropSummary;
  items: LibraryItemSummary[];
  language: Language;
};

function ArchiveDropCard({ drop, items, language }: ArchiveDropCardProps) {
  const copy = getLibraryCopy(language);
  const completionValue =
    drop.item_count > 0 ? drop.completed_item_count / drop.item_count : 0;
  const slotCounts = getArchiveSlotCounts(items);

  return (
    <Card elevated padding="md" style={styles.dropCard}>
      <View style={styles.dropHeader}>
        <View style={styles.dropTitleGroup}>
          <AppText color="muted" variant="caption">
            {copy.dropDateLabel} / {formatArchiveDate(drop.drop_date, language)} / {drop.language.toUpperCase()}
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
              {getTopicLabel(topic, language)}
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
                {copy.contentFilters[slot.id]}
              </AppText>
              <ProgressPill
                label={count > 0 ? `${count}` : copy.missing}
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
                {getContentTypeLabel(item.content_type, language)}
                {item.topic ? ` / ${getTopicLabel(item.topic, language)}` : ""}
              </AppText>
              <AppText numberOfLines={2} variant="bodyStrong">
                {item.title}
              </AppText>
            </View>
            <View style={styles.itemMeta}>
              {item.is_saved ? <ProgressPill label={copy.savedPill} tone="accent" /> : null}
              {item.is_completed ? <ProgressPill label={copy.donePill} tone="success" /> : null}
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

function getContentTypeLabel(contentType: ContentType, language: Language) {
  return getLibraryCopy(language).contentTypes[contentType];
}

function getTopicLabel(topic: LibraryItemSummary["topic"], language: Language): string {
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
    month: "short"
  }).format(new Date(`${date}T12:00:00Z`));
}

function getLibraryCopy(language: Language) {
  return localized(
    {
      en: {
        allTopics: "All topics",
        archiveEmptyDescription:
          "Completed and assigned drops will appear here by date after your first live daily drop.",
        archiveEyebrow: "Archive",
        archiveTitle: "Daily drops by date",
        cachedArchiveDescription:
          "The latest archive check is unavailable, so the app is showing the last archive kept in memory.",
        cachedArchiveTitle: "Cached archive",
        careerTopic: "Career",
        checkAgain: "Check again",
        clear: "Clear",
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
        description:
          "Return to previous daily briefings, saved ideas, and completed practice.",
        donePill: "Done",
        dropCount: (count: number) => `${count} drop${count === 1 ? "" : "s"}`,
        dropDateLabel: "Drop date",
        eyebrow: "Library",
        filteredEmptyDescription:
          "Your archive is still here. Clear filters or search for a broader topic.",
        filteredEmptyTitle: "No archived drop matches these filters",
        findDescription:
          "Filter by format, topic, or title. The archive stays finite: past daily drops only.",
        findTitle: "Find a past lesson",
        generalTopic: "General",
        liveArchiveDescription: "These archived drops are assigned to this account.",
        liveArchiveTitle: "Live archive",
        loadingDescription:
          "Looking for assigned past drops. Existing archive content stays visible while the app checks live data.",
        loadingTitle: "Loading archive",
        matchingSummary: (items: number, drops: number) =>
          `${items} matching item${items === 1 ? "" : "s"} across ${drops} daily drop${drops === 1 ? "" : "s"}.`,
        missing: "Missing",
        noLiveArchiveDescription:
          "No archived daily drops are assigned to this account yet. Preview archive content is shown below.",
        noLiveArchiveTitle: "No live archive yet",
        noResultsEyebrow: "No results",
        noSessionDescription:
          "Sign in to load your archived daily drops. Preview archive content is shown below.",
        noSessionTitle: "No active session",
        previewArchiveFallback: "The app is showing preview archive content for now.",
        previewArchiveTitle: "Preview archive",
        retryLiveArchive: "Retry live archive",
        retrySessionCheck: "Retry session check",
        savedDescription: "A quiet shelf for the pieces worth revisiting.",
        savedEmptyDescription: "Saved articles, mini-cases, and concepts will appear here.",
        savedEmptyTitle: "Nothing saved yet",
        savedEyebrow: "Saved",
        savedPill: "Saved",
        savedTitle: "Saved items",
        searchAccessibility: "Search library",
        searchPlaceholder: "Search archive",
        showFilter: "Show",
        title: "Past drops",
        topicFilter: "Topic",
        topics: {
          business: "Business",
          finance: "Finance",
          tech_ai: "Tech / AI",
          law: "Law",
          medicine: "Medicine",
          engineering: "Engineering",
          sport_business: "Sport Business",
          culture_media: "Culture / Media"
        }
      },
      fr: {
        allTopics: "Tous les sujets",
        archiveEmptyDescription:
          "Les mises à jour terminées et assignées apparaîtront ici par date après ton premier brief quotidien en direct.",
        archiveEyebrow: "Archives",
        archiveTitle: "Mises à jour par date",
        cachedArchiveDescription:
          "La dernière vérification des archives est indisponible, donc l'app affiche la dernière archive gardée en mémoire.",
        cachedArchiveTitle: "Archive en cache",
        careerTopic: "Carrière",
        checkAgain: "Vérifier à nouveau",
        clear: "Effacer",
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
        description:
          "Retrouve tes briefings précédents, tes idées sauvegardées et tes exercices terminés.",
        donePill: "Terminé",
        dropCount: (count: number) => `${count} mise${count > 1 ? "s" : ""} à jour`,
        dropDateLabel: "Date",
        eyebrow: "Bibliothèque",
        filteredEmptyDescription:
          "Ton archive est toujours là. Efface les filtres ou cherche un sujet plus large.",
        filteredEmptyTitle: "Aucune mise à jour ne correspond à ces filtres",
        findDescription:
          "Filtre par format, sujet ou titre. L'archive reste finie : uniquement les mises à jour passées.",
        findTitle: "Retrouver une leçon",
        generalTopic: "Général",
        liveArchiveDescription: "Ces archives sont assignées à ce compte.",
        liveArchiveTitle: "Archive en direct",
        loadingDescription:
          "Recherche des mises à jour passées assignées. L'archive existante reste visible pendant la vérification des données en direct.",
        loadingTitle: "Chargement de l'archive",
        matchingSummary: (items: number, drops: number) =>
          `${items} élément${items > 1 ? "s" : ""} correspondant${items > 1 ? "s" : ""} dans ${drops} mise${drops > 1 ? "s" : ""} à jour.`,
        missing: "Manquant",
        noLiveArchiveDescription:
          "Aucune archive en direct n'est encore assignée à ce compte. Le contenu de prévisualisation s'affiche ci-dessous.",
        noLiveArchiveTitle: "Aucune archive en direct",
        noResultsEyebrow: "Aucun résultat",
        noSessionDescription:
          "Connecte-toi pour charger tes mises à jour archivées. Le contenu de prévisualisation s'affiche ci-dessous.",
        noSessionTitle: "Aucune session active",
        previewArchiveFallback: "L'app affiche l'archive de prévisualisation pour le moment.",
        previewArchiveTitle: "Archive de prévisualisation",
        retryLiveArchive: "Réessayer l'archive en direct",
        retrySessionCheck: "Revérifier la session",
        savedDescription: "Un espace calme pour les éléments à revoir.",
        savedEmptyDescription: "Les articles, mini-cas et concepts sauvegardés apparaîtront ici.",
        savedEmptyTitle: "Rien de sauvegardé pour l'instant",
        savedEyebrow: "Sauvegardés",
        savedPill: "Sauvegardé",
        savedTitle: "Éléments sauvegardés",
        searchAccessibility: "Rechercher dans la bibliothèque",
        searchPlaceholder: "Rechercher dans l'archive",
        showFilter: "Afficher",
        title: "Mises à jour passées",
        topicFilter: "Sujet",
        topics: {
          business: "Business",
          finance: "Finance",
          tech_ai: "Tech / IA",
          law: "Droit",
          medicine: "Médecine",
          engineering: "Ingénierie",
          sport_business: "Business du sport",
          culture_media: "Culture / médias"
        }
      }
    },
    language
  );
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
