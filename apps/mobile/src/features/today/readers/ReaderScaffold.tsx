import type { PropsWithChildren, ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppText } from "../../../components";
import { tokens } from "../../../design/tokens";
import { useThemedStyles, type ThemeColors } from "../../../design/theme";

type ReaderScaffoldProps = PropsWithChildren<{
  eyebrow?: string;
  onClose: () => void;
  closeLabel: string;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}>;

export function ReaderScaffold({
  eyebrow,
  onClose,
  closeLabel,
  footer,
  contentStyle,
  children
}: ReaderScaffoldProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel={closeLabel}
          accessibilityRole="button"
          hitSlop={12}
          onPress={onClose}
          style={({ pressed }) => [styles.close, pressed ? styles.closePressed : null]}
        >
          <AppText color="muted" style={styles.closeGlyph} variant="subtitle">
            ←
          </AppText>
        </Pressable>
        {eyebrow ? (
          <AppText color="muted" variant="eyebrow">
            {eyebrow}
          </AppText>
        ) : null}
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView
        bounces
        contentContainerStyle={[styles.content, contentStyle]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: c.background
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    height: 48,
    justifyContent: "space-between",
    paddingHorizontal: tokens.space.lg
  },
  close: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    marginLeft: -tokens.space.xs,
    width: 40
  },
  closePressed: {
    opacity: 0.5
  },
  closeGlyph: {
    fontSize: 26,
    lineHeight: 28
  },
  topBarSpacer: {
    width: 40
  },
  content: {
    paddingBottom: tokens.space.xxl,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.sm
  },
  footer: {
    borderTopColor: c.border,
    borderTopWidth: 1,
    paddingBottom: tokens.space.sm,
    paddingHorizontal: tokens.space.lg,
    paddingTop: tokens.space.md
  }
  });
