import { useRef, type PropsWithChildren } from "react";
import {
  Animated,
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle
} from "react-native";

import { tokens } from "../design/tokens";
import { useReducedMotion } from "../design/useReducedMotion";
import { usePressedSurfaceStyle } from "../design/usePressedSurfaceStyle";

/**
 * The one way a large surface answers a finger.
 *
 * Two channels, deliberately different mechanisms:
 *
 *  - the tint is driven by Pressable's own `pressed` state, which flips on
 *    touch-down with no animation at all. That is the part that must be
 *    instantaneous, and an animation could only make it later.
 *  - the compression is a spring on the native driver, so it keeps running on
 *    the UI thread while JS is busy resolving the navigation the press just
 *    started.
 *
 * What it replaces is whole-surface opacity dimming, which faded the headline
 * along with the paper and read as "this card is disabled". Here the ink never
 * moves; only the sheet under it does.
 */

type PressableSurfaceProps = PropsWithChildren<{
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  /**
   * `card` compresses a hair on press; `row` keeps its geometry and is tinted
   * only. Rows sit directly against their neighbours, where a scaling row reads
   * as the list shifting rather than as one row responding.
   */
  variant?: "card" | "row";
  style?: StyleProp<ViewStyle>;
  /** Style applied only while pressed, on top of the shared tint. */
  pressedStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: "button" | "link";
  accessibilityState?: { selected?: boolean; disabled?: boolean; busy?: boolean };
  hitSlop?: number;
  testID?: string;
}>;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function PressableSurface({
  onPress,
  disabled = false,
  variant = "card",
  style,
  pressedStyle,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop,
  testID,
  children
}: PressableSurfaceProps) {
  const pressedSurface = usePressedSurfaceStyle();
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const compress = (toValue: number) => {
    // Reduce Motion keeps the press *visible* — the tint still fires — and only
    // drops the movement, which is what the setting is actually about.
    if (reduceMotion || variant === "row") {
      return;
    }

    Animated.spring(scale, {
      toValue,
      useNativeDriver: true,
      ...tokens.motion.pressSpring
    }).start();
  };

  return (
    <AnimatedPressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled, ...accessibilityState }}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      onPressIn={() => compress(tokens.press.cardScale)}
      onPressOut={() => compress(1)}
      style={({ pressed }) => [
        style,
        { transform: [{ scale }] },
        pressed && !disabled ? pressedSurface : null,
        pressed && !disabled ? pressedStyle : null
      ]}
      testID={testID}
    >
      {children}
    </AnimatedPressable>
  );
}
