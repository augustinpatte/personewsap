import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View
} from "react-native";

import {
  AppText,
  EmptyState,
  SecondaryButton
} from "../../components";
import { usePressedSurfaceStyle } from "../../design/usePressedSurfaceStyle";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import {
  resolveArchiveEmptyState,
  useArchive,
  useArchiveSearch,
  type ArchiveSearchState
} from "../archive";
import type { LibraryItemSummary } from "../library/libraryTypes";
import { editionDisplayDate } from "../today/contentCopy";
import { getModuleCopy } from "./moduleCopy";
import { ModuleError, ModuleLoading, ModuleScroll } from "./ModuleChrome";

/**
 * Title + date searchable archive list, shared by the Business Stories and
 * Mini Cases tabs.
 *
 * Browsing is paginated and finite: older editions arrive only when the reader
 * taps "load earlier", never by endless scrolling. Searching goes to the
 * server so it covers the whole history, not just the loaded pages.
 */
export function ItemArchiveList({
  items,
  contentType,
  searchPlaceholder,
  searchAccessibilityLabel,
  emptyTitle,
  emptyBody,
  onOpen,
  renderMeta
}: {
  items: LibraryItemSummary[];
  contentType: "business_story" | "mini_case";
  searchPlaceholder: string;
  searchAccessibilityLabel: string;
  emptyTitle: string;
  emptyBody: string;
  onOpen: (item: LibraryItemSummary) => void;
  /** Second line of a row (type-specific: topic, score, read state…). */
  renderMeta: (item: LibraryItemSummary) => ReactNode;
}) {
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const archive = useArchive();
  const copy = getModuleCopy(archive.language);
  const [query, setQuery] = useState("");
  const search = useArchiveSearch(query, items, contentType);

  if (archive.status !== "ready") {
    return <ModuleLoading label={copy.common.loading} />;
  }

  const emptyState = resolveArchiveEmptyState({
    itemCount: items.length,
    isSearchActive: search.isSearchActive,
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

  // Nothing of this kind in the editions loaded so far, but the archive has
  // older ones: say exactly that, and offer the same explicit one-page step the
  // list footer uses. Never an automatic search backwards.
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
        {archive.loadingMore ? <ActivityIndicator color={colors.muted} /> : null}
      </ModuleScroll>
    );
  }

  if (emptyState === "empty") {
    return (
      <ModuleScroll>
        <EmptyState description={emptyBody} iconName="archive" title={emptyTitle} />
      </ModuleScroll>
    );
  }

  return (
    <FlatList
      ListEmptyComponent={
        search.searching ? null : (
          <EmptyState
            actionLabel={copy.common.clearSearch}
            description={copy.common.noResultsBody}
            iconName="search"
            onActionPress={() => setQuery("")}
            title={copy.common.noResultsTitle}
          />
        )
      }
      ListFooterComponent={<ArchiveListFooter search={search} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <TextInput
            accessibilityLabel={searchAccessibilityLabel}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={styles.searchInput}
            value={query}
          />
          {search.searching ? (
            <AppText color="muted" variant="caption">
              {copy.common.searching}
            </AppText>
          ) : null}
          {search.isLocalFallback ? (
            <AppText color="muted" variant="caption">
              {copy.common.searchOffline}
            </AppText>
          ) : null}
        </View>
      }
      ListHeaderComponentStyle={styles.headerSpacing}
      contentContainerStyle={styles.listContent}
      data={search.results}
      keyExtractor={(item) => item.id}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <ArchiveRow item={item} onOpen={onOpen} renderMeta={renderMeta} />
      )}
      showsVerticalScrollIndicator={false}
    />
  );
}

/**
 * Deliberate end-of-list, in both modes: nothing ever loads by scrolling. While
 * browsing, older editions arrive on an explicit tap; while searching, further
 * result pages do too. The control disappears once there is nothing left, so
 * the end of the list is a real end.
 */
function ArchiveListFooter({ search }: { search: ArchiveSearchState }) {
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const archive = useArchive();
  const copy = getModuleCopy(archive.language);

  if (search.isSearchActive) {
    if (!search.hasMore && !search.loadMoreError) {
      return null;
    }

    return (
      <View style={styles.footer}>
        {search.loadMoreError ? (
          <AppText color="muted" variant="caption">
            {copy.common.searchPageFailed}
          </AppText>
        ) : null}
        {search.loadingMore ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <SecondaryButton
            label={
              search.loadMoreError ? copy.common.retry : copy.common.loadMoreResults
            }
            onPress={search.loadMore}
          />
        )}
      </View>
    );
  }

  if (!archive.hasMore) {
    return null;
  }

  return (
    <View style={styles.footer}>
      {archive.loadingMore ? (
        <ActivityIndicator color={colors.muted} />
      ) : (
        <SecondaryButton label={copy.common.loadEarlier} onPress={archive.loadMore} />
      )}
    </View>
  );
}

function ArchiveRow({
  item,
  onOpen,
  renderMeta
}: {
  item: LibraryItemSummary;
  onOpen: (item: LibraryItemSummary) => void;
  renderMeta: (item: LibraryItemSummary) => ReactNode;
}) {
  const styles = useThemedStyles(createStyles);
  const { language } = useArchive();
  const copy = getModuleCopy(language);
  // A row is tinted, not scaled: the list must not appear to shift under a tap.
  const pressedSurface = usePressedSurfaceStyle();

  return (
    <Pressable
      accessibilityHint={copy.common.openHint}
      accessibilityRole="button"
      onPress={() => onOpen(item)}
      style={({ pressed }) => [styles.row, pressed ? pressedSurface : null]}
    >
      {/* Date rail on the left, title as the thing you scan. The arrow sits
          with the date rather than beside the title, so nothing competes with
          the headline. */}
      <View style={styles.rowHead}>
        <AppText color="muted" variant="eyebrow">
          {/* The rail keeps its line either way, so an undated edition leaves
              no empty slot above the headline. */}
          {editionDisplayDate(item, language) ?? copy.common.undatedEdition}
        </AppText>
        <AppText color="mutedSoft" variant="label">
          →
        </AppText>
      </View>
      <AppText numberOfLines={2} style={styles.rowTitle} variant="subtitle">
        {item.title}
      </AppText>
      <View style={styles.rowMeta}>{renderMeta(item)}</View>
    </Pressable>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    header: {
      gap: tokens.space.sm
    },
    headerSpacing: {
      paddingBottom: tokens.space.md
    },
    listContent: {
      gap: tokens.space.lg,
      paddingBottom: tokens.space.xxl,
      paddingHorizontal: tokens.space.lg,
      paddingTop: tokens.space.lg
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
    footer: {
      paddingTop: tokens.space.xl
    },
    row: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.xs,
      minHeight: 44,
      paddingBottom: tokens.space.xs,
      paddingTop: tokens.space.lg
    },
    rowTitle: {
      lineHeight: 24
    },
    rowMeta: {
      minHeight: 18
    },
    rowHead: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between"
    }
  });
