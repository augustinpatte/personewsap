import { Linking, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { AppText } from "../../../components";
import { tokens } from "../../../design/tokens";
import { useThemeColors } from "../../../design/theme";
import {
  isSafeExternalUrl,
  parseMarkdownBlocks,
  type InlineSegment,
  type MarkdownBlock
} from "./markdown";

/**
 * Reader body renderer.
 *
 * Every visible line of a reader body flows through this component, and every
 * inline emphasis is applied without touching the font metrics: nested <Text>
 * spans only ever set fontWeight / fontStyle / color, so the whole body keeps
 * one uniform line rhythm (the `read` variant) on iOS and Android alike. This
 * is the structural guarantee that replaced the drop-cap opener, whose
 * oversized nested glyph inflated the first paragraph's line boxes.
 */

type MarkdownBodyProps = {
  markdown: string;
  style?: StyleProp<ViewStyle>;
};

export function MarkdownBody({ markdown, style }: MarkdownBodyProps) {
  const blocks = parseMarkdownBlocks(markdown);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <View style={[styles.body, style]}>
      {blocks.map((block, index) => (
        <MarkdownBlockView block={block} key={index} />
      ))}
    </View>
  );
}

function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
  if (block.type === "bullet") {
    return (
      <View style={styles.bulletRow}>
        <AppText color="muted" variant="read">
          –
        </AppText>
        <AppText style={styles.bulletText} variant="read">
          <InlineSegments segments={block.segments} />
        </AppText>
      </View>
    );
  }

  if (block.type === "heading") {
    return (
      <AppText color="muted" variant="eyebrow">
        <InlineSegments segments={block.segments} />
      </AppText>
    );
  }

  return (
    <AppText variant="read">
      <InlineSegments segments={block.segments} />
    </AppText>
  );
}

function InlineSegments({ segments }: { segments: InlineSegment[] }) {
  const colors = useThemeColors();

  return (
    <>
      {segments.map((segment, index) => {
        const isLink = Boolean(segment.href);

        return (
          <Text
            accessibilityRole={isLink ? "link" : undefined}
            key={index}
            onPress={isLink ? () => openExternalUrl(segment.href!) : undefined}
            style={[
              segment.bold ? styles.bold : null,
              segment.italic ? styles.italic : null,
              isLink ? [styles.link, { color: colors.accentInk }] : null
            ]}
            suppressHighlighting={!isLink}
          >
            {segment.text}
          </Text>
        );
      })}
    </>
  );
}

function openExternalUrl(url: string) {
  if (!isSafeExternalUrl(url)) {
    return;
  }

  Linking.openURL(url).catch(() => {
    // A device without a handler for the URL is not an app error.
  });
}

// Emphasis styles deliberately never change font metrics: the parent `read`
// text style owns the line rhythm for the entire body.
const styles = StyleSheet.create({
  body: {
    gap: tokens.space.lg
  },
  bulletRow: {
    flexDirection: "row",
    gap: tokens.space.md
  },
  bulletText: {
    flex: 1
  },
  bold: {
    fontWeight: tokens.typography.weight.semibold
  },
  italic: {
    fontStyle: "italic"
  },
  link: {
    textDecorationLine: "underline"
  }
});
