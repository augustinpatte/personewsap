import { Feather } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "../../components/AppText";
import { tokens } from "../../design/tokens";
import { useThemeColors } from "../../design/theme";
import { useReducedMotion } from "../../design/useReducedMotion";
import { localized } from "../../lib/i18n";
import type { Language } from "../../types/domain";
import { useNotificationDisabledBanner } from "./useNotificationDisabledBanner";

/**
 * A thin line of warm orange under the status bar, for five seconds.
 *
 * It floats over the screen instead of taking a strip of layout, so nothing
 * underneath moves when it appears or leaves. It is a Pressable, not a modal:
 * the app stays fully usable around it, and a tap opens the Notifications
 * section of Settings.
 */
export function NotificationDisabledBanner() {
  const { visible, language, open } = useNotificationDisabledBanner();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);
  const copy = getBannerCopy(language);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      AccessibilityInfo.announceForAccessibility(copy.message);
    }

    // One short fade either way; the motion budget stays where it is spent.
    // With Reduce Motion on, it simply appears and leaves.
    const animation = Animated.timing(opacity, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : 180,
      useNativeDriver: true
    });

    animation.start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false);
      }
    });

    return () => animation.stop();
  }, [copy.message, opacity, reduceMotion, visible]);

  if (!mounted && !visible) {
    return null;
  }

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: insets.top + tokens.space.xs }]}
    >
      <Animated.View pointerEvents={visible ? "auto" : "none"} style={{ opacity }}>
        <Pressable
          accessibilityHint={copy.hint}
          accessibilityLabel={copy.message}
          accessibilityRole="button"
          hitSlop={4}
          onPress={open}
          style={({ pressed }) => [
            styles.banner,
            { backgroundColor: colors.notice, opacity: pressed ? 0.86 : 1 }
          ]}
          testID="notifications-disabled-banner"
        >
          <Feather color={colors.onNotice} name="bell-off" size={14} />
          <AppText numberOfLines={2} style={[styles.message, { color: colors.onNotice }]} variant="caption">
            {copy.message}
          </AppText>
          <Feather color={colors.onNotice} name="chevron-right" size={14} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function getBannerCopy(language: Language | null | undefined) {
  return localized(
    {
      en: {
        message: "Notifications are off — don't miss today's session with your friends.",
        hint: "Opens notification settings. Turn them on to get the most out of PersoNews."
      },
      fr: {
        message: "Notifications désactivées — ne manquez pas la session du jour avec vos amis.",
        hint: "Ouvre les réglages de notification. Activez-les pour profiter pleinement de PersoNews."
      }
    },
    language
  );
}

const styles = StyleSheet.create({
  host: {
    left: tokens.space.lg,
    position: "absolute",
    right: tokens.space.lg,
    zIndex: 10
  },
  banner: {
    alignItems: "center",
    borderRadius: tokens.radius.md,
    flexDirection: "row",
    gap: tokens.space.sm,
    minHeight: 36,
    paddingHorizontal: tokens.space.md,
    paddingVertical: tokens.space.xs + 2
  },
  message: {
    flex: 1,
    fontWeight: "600"
  }
});
