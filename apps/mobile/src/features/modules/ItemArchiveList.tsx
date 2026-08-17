import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View
} from "react-native";

import { AppText, EmptyState, SecondaryButton } from "../../components";
import { tokens } from "../../design/tokens";
import { useThemeColors, useThemedStyles, type ThemeColors } from "../../design/theme";
import { useArchive, useArchiveSearch } from "../archive";
import type { LibraryItemSummary } from "../library/libraryTypes";
import { formatDropDate } from "../today/contentCopy";
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

  if (archive.status === "loading") {
    return <ModuleLoading label={copy.common.loading} />;
  }

  if (items.length === 0 && !search.isSearchActive) {
    return (
      <ModuleScroll>
        {archive.error ? (
          <ModuleError language={archive.language} onRetry={archive.reload} />
        ) : (
          <EmptyState description={emptyBody} title={emptyTitle} />
        )}
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
            onActionPress={() => setQuery("")}
            title={copy.common.noResultsTitle}
          />
        )
      }
      ListFooterComponent={
        <ArchiveListFooter isSearchActive={search.isSearchActive} />
      }
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
 * Deliberate end-of-list: while browsing, older editions load on an explicit
 * tap. Search results are already whole-history, so nothing to page there.
 */
function ArchiveListFooter({ isSearchActive }: { isSearchActive: boolean }) {
  const styles = useThemedStyles(createStyles);
  const colors = useThemeColors();
  const archive = useArchive();
  const copy = getModuleCopy(archive.language);

  if (isSearchActive || !archive.hasMore) {
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

  return (
    <Pressable
      accessibilityHint={copy.common.openHint}
      accessibilityRole="button"
      onPress={() => onOpen(item)}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.rowHead}>
        <AppText color="muted" variant="eyebrow">
          {formatDropDate(item.drop_date, language)}
        </AppText>
        <AppText color="accentInk" variant="label">
          →
        </AppText>
      </View>
      <AppText numberOfLines={2} variant="subtitle">
        {item.title}
      </AppText>
      {renderMeta(item)}
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
      paddingTop: tokens.space.lg
    },
    rowPressed: {
      opacity: 0.6
    },
    rowHead: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between"
    }
  });
