import { Platform } from "react-native";

const serifFamily =
  Platform.select({ ios: "Georgia", android: "serif", default: "Georgia" }) ?? "Georgia";

export const tokens = {
  color: {
    background: "#F5F1E8",
    backgroundRaised: "#FBF8F1",
    surface: "#FCFAF4",
    surfaceMuted: "#EFEBE1",
    ink: "#1C1A16",
    inkSoft: "#4A463D",
    muted: "#6E685C",
    mutedSoft: "#A39C8C",
    border: "#E6E0D3",
    borderStrong: "#D2CABA",
    accent: "#0F5B5F",
    accentPressed: "#0A4649",
    accentSoft: "#E7EFEC",
    accentInk: "#0B4144",
    gold: "#9C7B3F",
    goldSoft: "#EFE7D6",
    success: "#3F7A5B",
    successSoft: "#E6EEE7",
    warning: "#94703A",
    warningSoft: "#EFE7D6",
    danger: "#9B3D33",
    dangerSoft: "#F1E3DF",
    white: "#FFFFFF",
    black: "#000000",
    transparent: "transparent"
  },
  space: {
    none: 0,
    xs: 4,
    sm: 8,
    md: 12,
    lg: 20,
    xl: 32,
    xxl: 48
  },
  radius: {
    xs: 4,
    sm: 6,
    md: 10,
    lg: 16,
    xl: 22,
    pill: 999
  },
  typography: {
    family: {
      regular: "System",
      medium: "System",
      semibold: "System",
      bold: "System",
      serif: serifFamily
    },
    size: {
      eyebrow: 11,
      caption: 13,
      label: 14,
      body: 16,
      bodyLarge: 18,
      read: 18,
      lede: 20,
      subtitle: 22,
      quote: 25,
      title: 31,
      display: 37,
      dropCap: 58
    },
    lineHeight: {
      eyebrow: 14,
      caption: 19,
      label: 18,
      body: 24,
      bodyLarge: 26,
      read: 30,
      lede: 30,
      subtitle: 29,
      quote: 34,
      title: 37,
      display: 43,
      dropCap: 52
    },
    weight: {
      regular: "400",
      medium: "500",
      semibold: "600",
      bold: "700"
    },
    /**
     * Tracking is a function of size, never one value for the whole app: type
     * set large reads too loose and has to be pulled in, type set small reads
     * too tight and has to be opened up. The per-variant values live in
     * AppText; these are the two cases that sit outside it.
     */
    tracking: {
      /** Serif display quotes at 25pt, where 0 already reads slightly loose. */
      quote: -0.2,
      /** Small caps used as a label — letterforms need air to stay countable. */
      smallCaps: 1.4
    },
    bodyLineHeight: 24,
    titleLineHeight: 36
  },
  /**
   * How a surface answers a finger.
   *
   * One product-wide answer instead of the per-screen opacity values this
   * replaced (0.5 / 0.6 / 0.7 / 0.72), which dimmed the text along with the
   * surface and read as "disabled" rather than "pressed". A press now tints the
   * surface — instantly, on touch-down — and large surfaces additionally
   * compress by a hair. Text is never dimmed.
   */
  press: {
    /**
     * Large editorial surfaces (a lead article, an archive row, a session
     * card). Deliberately shallower than the 0.98 of a typical button: these
     * blocks are wide, and on a wide block even 2% reads as a lurch.
     */
    cardScale: 0.99,
    /** Small controls keep their geometry; the tint alone carries the press. */
    controlScale: 1
  },
  motion: {
    /**
     * Content arriving after a load. Long enough to be perceived as arriving
     * rather than blinking, short enough never to feel like a wait.
     */
    contentRevealMs: 180,
    /**
     * Press compression. Near-critically damped (ratio ≈ 1.0) so it settles
     * without a bounce: a card is paper, not rubber. Press-in is effectively
     * instantaneous; the release is what settles.
     */
    pressSpring: {
      damping: 28,
      mass: 0.6,
      stiffness: 320
    }
  },
  shadow: {
    none: {
      shadowOpacity: 0,
      elevation: 0
    },
    sm: {
      shadowColor: "#1C1A16",
      shadowOpacity: 0.04,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 1
    },
    md: {
      shadowColor: "#1C1A16",
      shadowOpacity: 0.06,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 2
    }
  }
} as const;

export type ColorToken = keyof typeof tokens.color;
export type SpaceToken = keyof typeof tokens.space;
export type RadiusToken = keyof typeof tokens.radius;
