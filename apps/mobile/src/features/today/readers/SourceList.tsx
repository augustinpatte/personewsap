import { useState } from "react";
import { Feather } from "@expo/vector-icons";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import * as Clipboard from "expo-clipboard";

import { AppText } from "../../../components";
import { usePressedSurfaceStyle } from "../../../design/usePressedSurfaceStyle";
import { tokens } from "../../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../../design/theme";
import { getSourcesCopy } from "../contentCopy";
import type { ContentLanguage, SourceMetadata } from "../contentTypes";
import {
  formatSourceMeta,
  getSourceName,
  toDisplaySources,
  type DisplaySource
} from "../sources";

/**
 * What a piece of editorial content was built from.
 *
 * Rendered last, in the quietest type on the page: the reading is the product,
 * and this is the receipt. Nothing here is generated — every line comes from a
 * `public.sources` row the content item actually cites, and a record missing a
 * publisher or a date simply shows fewer lines. An item with no usable source
 * record renders nothing at all rather than an empty heading, which is why this
 * returns null instead of an "unavailable" state.
 *
 * One component for every reader and every route: today's edition, the archive,
 * the library and a direct link all reach it through the same item, so archived
 * content is as transparent as content published this morning.
 */
export function SourceList({
  language,
  sources
}: {
  language: ContentLanguage;
  sources: SourceMetadata[] | null | undefined;
}) {
  const styles = useThemedStyles(createStyles);
  const copy = getSourcesCopy(language);
  const [failedSourceId, setFailedSourceId] = useState<string | null>(null);
  const [copiedFallbackUrl, setCopiedFallbackUrl] = useState(false);
  const displaySources = toDisplaySources(sources);

  if (displaySources.length === 0) {
    return null;
  }

  const onOpen = async (source: DisplaySource) => {
    setFailedSourceId(null);

    try {
      // Called through rather than passed by reference: Linking is a class
      // instance whose openURL reads `this`.
      await Linking.openURL(source.url);
      return;
    } catch {
      // Never surfaced raw. "Unable to open URL" is the OS talking to a
      // developer; the reader gets a sentence and the link on their clipboard.
    }

    let copied = false;

    try {
      await Clipboard.setStringAsync(source.url);
      copied = true;
    } catch {
      copied = false;
    }

    setCopiedFallbackUrl(copied);
    setFailedSourceId(source.id);
  };

  return (
    <View style={styles.sources}>
      <AppText color="muted" variant="eyebrow">
        {copy.heading}
      </AppText>

      <View style={styles.list}>
        {displaySources.map((source) => (
          <SourceRow
            copy={copy}
            failed={failedSourceId === source.id}
            failedWasCopied={copiedFallbackUrl}
            key={source.id}
            language={language}
            onPress={() => {
              void onOpen(source);
            }}
            source={source}
          />
        ))}
      </View>
    </View>
  );
}

function SourceRow({
  copy,
  failed,
  failedWasCopied,
  language,
  onPress,
  source
}: {
  copy: ReturnType<typeof getSourcesCopy>;
  failed: boolean;
  failedWasCopied: boolean;
  language: ContentLanguage;
  onPress: () => void;
  source: DisplaySource;
}) {
  const styles = useThemedStyles(createStyles);
  const pressedSurface = usePressedSurfaceStyle();
  const name = getSourceName(source);
  const meta = formatSourceMeta(source, language);

  return (
    <View>
      <Pressable
        accessibilityHint={source.domain}
        accessibilityLabel={copy.openSource(name)}
        accessibilityRole="link"
        onPress={onPress}
        style={({ pressed }) => [styles.row, pressed ? pressedSurface : null]}
      >
        <View style={styles.rowCopy}>
          {/* Publisher leads — it is what tells the reader how much weight to
              give the citation. The title and the date/domain line sit under it
              in progressively quieter type. */}
          <AppText variant="bodyStrong">{name}</AppText>

          {source.title ? (
            <AppText color="inkSoft" variant="body">
              {source.title}
            </AppText>
          ) : null}

          {meta ? (
            <AppText color="muted" variant="caption">
              {meta}
            </AppText>
          ) : null}
        </View>

        <Feather name="external-link" size={14} style={styles.rowIcon} />
      </Pressable>

      {failed ? (
        <AppText color="muted" style={styles.rowNotice} variant="caption">
          {failedWasCopied ? copy.openFailed : copy.openFailedWithoutCopy}
        </AppText>
      ) : null}
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    sources: {
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: tokens.space.md,
      marginTop: tokens.space.xxl,
      paddingTop: tokens.space.lg
    },
    list: {
      gap: tokens.space.xs
    },
    row: {
      alignItems: "flex-start",
      borderRadius: tokens.radius.sm,
      flexDirection: "row",
      gap: tokens.space.md,
      // A hairline rule between entries rather than a card each: the section is
      // a reference list, not four more things to read.
      borderTopColor: c.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      // Vertical padding, not a fixed height: the row grows with the title and
      // with Dynamic Type, and keeps a comfortable touch target when it is a
      // single line.
      paddingVertical: tokens.space.md
    },
    rowCopy: {
      flex: 1,
      gap: tokens.space.xs,
      minHeight: 20
    },
    rowIcon: {
      color: c.mutedSoft,
      marginTop: tokens.space.xs
    },
    rowNotice: {
      paddingBottom: tokens.space.sm
    }
  });
