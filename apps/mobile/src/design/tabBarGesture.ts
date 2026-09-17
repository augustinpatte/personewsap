/**
 * The rules of dragging across the bottom bar, free of React and of React
 * Native so the whole matrix is unit tested rather than eyeballed on a device.
 *
 * The bar used to be five separate buttons: a press either landed on one or on
 * nothing, and a finger that moved was a cancelled tap. This turns the row into
 * one continuous control — touch it, slide, and the selection follows the
 * finger — without giving the app a global horizontal swipe. Every rule below
 * is about telling those two apart:
 *
 *   * a TAP is never claimed here. The gesture only takes over once the finger
 *     has travelled, so a press goes to the button under it with no delay;
 *   * a VERTICAL drag is never claimed either, or a reader scrolling a page
 *     that ends near the bar would change tab by accident;
 *   * the gesture lives on the bar's own row, so nothing outside it is touched.
 */

export const TAB_DRAG = {
  /**
   * How far the finger travels before the row takes the gesture. Eight points
   * is past the slop of an ordinary tap and well under a deliberate slide.
   */
  claimDistance: 8,
  /**
   * How much more horizontal than vertical the movement has to be. A finger
   * heading up the page at 45° is scrolling, not choosing a tab.
   */
  directionRatio: 1.2
} as const;

/** Should the row take over this movement, or leave it to the scroll and the buttons? */
export function isHorizontalDrag(movement: { dx: number; dy: number }): boolean {
  const horizontal = Math.abs(movement.dx);
  const vertical = Math.abs(movement.dy);

  return horizontal >= TAB_DRAG.claimDistance && horizontal > vertical * TAB_DRAG.directionRatio;
}

/**
 * Which tab the finger is over, from its position along the row.
 *
 * Clamped rather than wrapped: sliding past the last tab keeps the last tab,
 * which is what a segmented control does and what a thumb running off the edge
 * of the glass expects.
 */
export function nearestTabIndex(input: { x: number; tabWidth: number; count: number }): number {
  if (input.count <= 0 || input.tabWidth <= 0) {
    return 0;
  }

  const index = Math.floor(input.x / input.tabWidth);

  return Math.min(Math.max(index, 0), input.count - 1);
}

/**
 * Does this change of target deserve the selection tick?
 *
 * Only a drag that crosses from one tab into another does. Two things
 * deliberately stay silent:
 *
 *   * the touch-down that begins a drag. The finger has landed, nothing has
 *     been crossed, and a tick there would fire even on the tab the reader is
 *     already standing on. A drag seeds its target with the current selection,
 *     so the first target is not a crossing;
 *   * a tap, which never reaches this at all — the row only claims a gesture
 *     once the finger has travelled, so a press belongs to its button.
 *
 * `previousTarget` below −1 means "no target yet", which is what a drag starts
 * from if it is ever seeded that way again.
 */
export function crossesIntoNewTab(previousTarget: number, nextTarget: number): boolean {
  return previousTarget >= 0 && nextTarget !== previousTarget;
}

/** Where the moving capsule sits for a given tab. */
export function tabOffset(index: number, tabWidth: number): number {
  return Math.max(index, 0) * tabWidth;
}

/**
 * Expo Router hides a route from the bar by giving it `tabBarItemStyle:
 * { display: "none" }` (that is what `href: null` compiles to) while leaving it
 * in the navigator's state. A custom bar that ignored this would render
 * Settings as a sixth tab.
 *
 * Written without StyleSheet.flatten so this module stays free of React Native
 * and can be tested as plain data.
 */
export function isHiddenTabStyle(style: unknown): boolean {
  if (Array.isArray(style)) {
    return style.some((entry) => isHiddenTabStyle(entry));
  }

  if (style && typeof style === "object") {
    return (style as { display?: unknown }).display === "none";
  }

  return false;
}
