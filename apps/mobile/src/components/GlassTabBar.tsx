import {
  BottomTabBarHeightCallbackContext,
  type BottomTabBarProps
} from "@react-navigation/bottom-tabs";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "../design/theme";
import {
  crossesIntoNewTab,
  isHiddenTabStyle,
  isHorizontalDrag,
  nearestTabIndex,
  tabOffset
} from "../design/tabBarGesture";
import { resolveTabBarGlass, TAB_BAR_GLASS, tabBarBottomInset } from "../design/tabBarMaterial";
import { useReducedMotion } from "../design/useReducedMotion";
import { selectionChanged } from "../lib/haptics";
import { TabBarBackground } from "./TabBarBackground";

/**
 * The bottom bar: one piece of glass, five destinations, and a selection you
 * can slide.
 *
 * WHY ONE COMPONENT RATHER THAN FIVE BUTTONS. The bar used to be React
 * Navigation's own, customised per button (`tabBarButton`) with the glass
 * behind it (`tabBarBackground`). A drag cannot be built that way: each button
 * owns its own touches, so a finger crossing from Newsletter to Mini cases
 * leaves one responder and never reaches the next. The row has to be a single
 * responder, which is what a custom `tabBar` is. The navigator, the routes and
 * the state are untouched — this reads `state`, `descriptors` and `navigation`
 * and renders them.
 *
 * WHAT DRIVES THE MOVEMENT. No gesture or animation library is installed in
 * this project, and one would not be worth adding for a bar: `PanResponder` and
 * `Animated` ship with React Native. The capsule's translation runs on the
 * native driver, so the only React state during a drag is the target tab —
 * which changes a handful of times, not sixty times a second. The row's
 * geometry is measured when it lays out, never per frame.
 *
 * WHAT IS DELIBERATELY NOT HERE. No global swipe: the responder belongs to this
 * row alone, so vertical scrolling, a carousel above the bar and a button just
 * over it all keep their own touches. And the drag is an enhancement — every
 * tab is still a button a screen reader can find and press.
 */
export function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const glass = resolveTabBarGlass({ isDark });
  const reduceMotion = useReducedMotion();
  const bottomInset = tabBarBottomInset(insets.bottom);
  // The navigator asks the bar how tall it is, and the default bar answers from
  // its own layout. A custom bar that stayed silent would leave every screen on
  // the navigator's estimate — and `useTabBarInset` reads that answer, which is
  // what ends a scroll above the glass instead of under it.
  const reportHeight = useContext(BottomTabBarHeightCallbackContext);

  // Expo Router keeps a `href: null` route in the navigator and hides it with
  // `tabBarItemStyle: { display: "none" }`. Settings is such a route: it lives
  // in this group, keeps the bar and its inset, and is not a destination.
  const tabs = useMemo(
    () =>
      state.routes
        .map((route, index) => ({ route, index, options: descriptors[route.key].options }))
        .filter(({ options }) => !isHiddenTabStyle(options.tabBarItemStyle)),
    [descriptors, state.routes]
  );

  const selected = Math.max(
    tabs.findIndex((tab) => tab.index === state.index),
    0
  );

  const [rowWidth, setRowWidth] = useState(0);
  /** The tab the finger is over, while it is down. Null the rest of the time. */
  const [dragTarget, setDragTarget] = useState<number | null>(null);
  const tabWidth = tabs.length > 0 && rowWidth > 0 ? rowWidth / tabs.length : 0;
  const highlighted = dragTarget ?? selected;

  const indicator = useRef(new Animated.Value(0)).current;
  const geometry = useRef({ pageX: 0, tabWidth: 0, count: 0 });
  const drag = useRef({ active: false, target: -1 });
  const rowRef = useRef<View>(null);

  geometry.current = { ...geometry.current, tabWidth, count: tabs.length };

  // Follow the selection when it changes for any other reason: a tap, a deep
  // link, a notification opening the Newsletter tab, a remount.
  useEffect(() => {
    if (drag.current.active || tabWidth <= 0) {
      return;
    }

    const destination = tabOffset(selected, tabWidth);

    if (reduceMotion) {
      indicator.setValue(destination);
      return;
    }

    Animated.spring(indicator, {
      toValue: destination,
      bounciness: 0,
      speed: 18,
      useNativeDriver: true
    }).start();
  }, [indicator, reduceMotion, selected, tabWidth]);

  const openTab = (tabIndex: number) => {
    const tab = tabs[tabIndex];

    if (!tab) {
      return;
    }

    const event = navigation.emit({
      type: "tabPress",
      target: tab.route.key,
      canPreventDefault: true
    });

    if (tab.index !== state.index && !event.defaultPrevented) {
      navigation.navigate(tab.route.name, tab.route.params);
    }
  };

  const moveTo = (tabIndex: number) => {
    const previous = drag.current.target;

    if (tabIndex === previous) {
      return;
    }

    drag.current.target = tabIndex;
    setDragTarget(tabIndex);

    // Once per tab actually crossed, never per frame and never on the touch
    // that starts the drag: the finger is over glass rather than over the tab
    // it is choosing, so this is the confirmation that the target moved.
    if (crossesIntoNewTab(previous, tabIndex)) {
      selectionChanged();
    }

    const destination = tabOffset(tabIndex, geometry.current.tabWidth);

    if (reduceMotion) {
      indicator.setValue(destination);
      return;
    }

    Animated.spring(indicator, {
      toValue: destination,
      bounciness: 0,
      speed: 20,
      useNativeDriver: true
    }).start();
  };

  const targetFromTouch = (pageX: number) =>
    nearestTabIndex({
      x: pageX - geometry.current.pageX,
      tabWidth: geometry.current.tabWidth,
      count: geometry.current.count
    });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // A press is never claimed here: it belongs to the button under the
        // finger, so a tap stays a tap with no delay in front of it.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, gesture) => isHorizontalDrag(gesture),
        onPanResponderGrant: (event) => {
          // Seeded with the tab the reader is already on, silently: landing on
          // the glass is not a crossing, so the first tick can only come from
          // the finger actually reaching another tab.
          drag.current = { active: true, target: selected };
          moveTo(targetFromTouch(event.nativeEvent.pageX));
        },
        onPanResponderMove: (event) => {
          moveTo(targetFromTouch(event.nativeEvent.pageX));
        },
        onPanResponderRelease: () => {
          const target = drag.current.target;

          drag.current = { active: false, target: -1 };
          setDragTarget(null);

          if (target >= 0) {
            openTab(target);
          }
        },
        onPanResponderTerminate: () => {
          drag.current = { active: false, target: -1 };
          setDragTarget(null);
          indicator.setValue(tabOffset(selected, geometry.current.tabWidth));
        }
      }),
    // Rebuilt only when what it acts on changes, never on a drag frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reduceMotion, selected, state.index, tabs.length]
  );

  const onRowLayout = (event: LayoutChangeEvent) => {
    setRowWidth(event.nativeEvent.layout.width);
    // One measurement per layout, so a drag never has to ask where the row is.
    rowRef.current?.measureInWindow((x) => {
      geometry.current = { ...geometry.current, pageX: x };
    });
  };

  return (
    <View
      onLayout={(event) => reportHeight?.(event.nativeEvent.layout.height)}
      style={[
        styles.bar,
        { minHeight: 68 + bottomInset, paddingBottom: bottomInset }
      ]}
    >
      <TabBarBackground />

      <View
        onLayout={onRowLayout}
        ref={rowRef}
        style={styles.row}
        {...panResponder.panHandlers}
      >
        {tabWidth > 0 ? (
          // One capsule for the whole bar rather than one per button: it is the
          // same piece of glass moving, which is what makes the row read as a
          // single control instead of five.
          <Animated.View
            pointerEvents="none"
            style={[
              styles.capsule,
              {
                backgroundColor: glass.activeSurface,
                borderColor: glass.activeBorder,
                borderRadius: TAB_BAR_GLASS.itemRadius,
                transform: [{ translateX: indicator }],
                width: tabWidth - TAB_BAR_GLASS.capsuleInset * 2,
                marginLeft: TAB_BAR_GLASS.capsuleInset
              }
            ]}
          />
        ) : null}

        {tabs.map((tab, tabIndex) => {
          const focused = tabIndex === highlighted;
          const color = focused
            ? tab.options.tabBarActiveTintColor ?? colors.ink
            : tab.options.tabBarInactiveTintColor ?? colors.muted;

          return (
            <Pressable
              accessibilityLabel={tab.options.tabBarAccessibilityLabel ?? tab.options.title}
              accessibilityRole="button"
              accessibilityState={{ selected: tabIndex === selected }}
              key={tab.route.key}
              onLongPress={() =>
                navigation.emit({ type: "tabLongPress", target: tab.route.key })
              }
              onPress={() => openTab(tabIndex)}
              style={styles.tab}
              testID={tab.options.tabBarButtonTestID}
            >
              {tab.options.tabBarIcon?.({ focused, color, size: 20 })}
              <Text numberOfLines={1} style={[styles.label, { color }]}>
                {tab.options.title ?? tab.route.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    // The bar floats over the content instead of reserving a strip of layout,
    // so a headline scrolls under it and the glass has something to be
    // translucent about. Every scrollable surface inside the tabs ends above it
    // via useTabBarInset.
    backgroundColor: "transparent",
    bottom: 0,
    left: 0,
    paddingTop: 8,
    position: "absolute",
    right: 0
  },
  row: {
    flexDirection: "row"
  },
  capsule: {
    borderWidth: StyleSheet.hairlineWidth,
    bottom: 2,
    left: 0,
    position: "absolute",
    top: 0
  },
  tab: {
    alignItems: "center",
    flex: 1,
    gap: 2,
    justifyContent: "center",
    // Comfortably above the 44pt minimum target on every device.
    minHeight: 44,
    paddingVertical: 3
  },
  label: {
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 0
  }
});
