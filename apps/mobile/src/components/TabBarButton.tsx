import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import { Pressable, StyleSheet, View } from "react-native";

import { useTheme } from "../design/theme";
import { resolveTabBarGlass, TAB_BAR_GLASS } from "../design/tabBarMaterial";

/**
 * One tab, and the capsule under the selected one.
 *
 * The selected tab is lifted out of the same glass rather than sat on top of
 * it: a slightly brighter translucent capsule with the same light edge, behind
 * the icon and the label React Navigation already renders. No colour fill, no
 * glow, no bubble — the tint change on the icon and the label does the naming,
 * and this only says which part of the glass the reader is standing on.
 *
 * Everything else is forwarded untouched: the press, the long press, the
 * accessibility state and label, the test id. The navigation behaviour is
 * React Navigation's, exactly as before.
 */
export function TabBarButton({
  children,
  onPress,
  style,
  // PlatformPressable's own props: a plain Pressable has no use for them,
  // `href` is web-only, and its `ref` is typed for an Animated view rather
  // than this one. The navigator does not read the ref back for a tab.
  href: _href,
  pressColor: _pressColor,
  pressOpacity: _pressOpacity,
  hoverEffect: _hoverEffect,
  ref: _ref,
  ...rest
}: BottomTabBarButtonProps) {
  const { isDark } = useTheme();
  const glass = resolveTabBarGlass({ isDark });
  const selected = rest.accessibilityState?.selected === true;

  return (
    <Pressable
      {...rest}
      onPress={(event) => onPress?.(event)}
      style={[styles.button, style]}
    >
      {selected ? (
        <View
          style={[
            styles.capsule,
            {
              backgroundColor: glass.activeSurface,
              borderColor: glass.activeBorder,
              borderRadius: TAB_BAR_GLASS.itemRadius
            }
          ]}
        />
      ) : null}
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  capsule: {
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 2,
    left: 8,
    position: "absolute",
    right: 8,
    top: 0
  }
});
