import { useEffect, useRef, type PropsWithChildren } from "react";
import { Animated, type StyleProp, type ViewStyle } from "react-native";

import { tokens } from "../design/tokens";
import { useReducedMotion } from "../design/useReducedMotion";

/**
 * Content taking the place of its placeholder.
 *
 * A hard swap from grey blocks to a full page of type is a visible snap; a
 * short fade reads as the page settling. Opacity only — no slide, no scale, no
 * bounce: the content is already in its final position, and moving it would
 * claim something happened that did not.
 *
 * Nothing is ever delayed to make room for this. The fade starts on the frame
 * the content mounts, so the reader waits exactly as long as the data took and
 * not a millisecond more.
 */
export function ContentReveal({
  style,
  children
}: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const reduceMotion = useReducedMotion();
  // Starting at 1 under Reduce Motion means the very first frame is already
  // opaque: the content appears, it simply does not fade.
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }

    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: tokens.motion.contentRevealMs,
      useNativeDriver: true
    });

    animation.start();

    return () => {
      animation.stop();
    };
  }, [opacity, reduceMotion]);

  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}
