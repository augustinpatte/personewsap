export const tokens = {
  color: {
    background: "#F6F3EC",
    backgroundRaised: "#FBFAF7",
    surface: "#FFFFFF",
    surfaceMuted: "#F1EEE7",
    ink: "#111827",
    inkSoft: "#334155",
    muted: "#667085",
    mutedSoft: "#98A2B3",
    border: "#E3DED3",
    borderStrong: "#CCC4B6",
    accent: "#0F5B5F",
    accentPressed: "#0A4649",
    accentSoft: "#E5F1EF",
    accentInk: "#073B3D",
    gold: "#B88932",
    goldSoft: "#F5EAD6",
    success: "#1B8A5A",
    successSoft: "#E4F4EC",
    warning: "#B66A00",
    warningSoft: "#FFF0D8",
    danger: "#B42318",
    dangerSoft: "#FDE8E5",
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
    md: 8,
    lg: 14,
    xl: 20,
    pill: 999
  },
  typography: {
    family: {
      regular: "System",
      medium: "System",
      semibold: "System",
      bold: "System"
    },
    size: {
      eyebrow: 11,
      caption: 12,
      label: 14,
      body: 16,
      bodyLarge: 18,
      subtitle: 20,
      title: 32,
      display: 38
    },
    lineHeight: {
      eyebrow: 14,
      caption: 16,
      label: 18,
      body: 23,
      bodyLarge: 26,
      subtitle: 27,
      title: 37,
      display: 44
    },
    weight: {
      regular: "400",
      medium: "500",
      semibold: "600",
      bold: "800"
    },
    bodyLineHeight: 23,
    titleLineHeight: 37
  },
  shadow: {
    none: {
      shadowOpacity: 0,
      elevation: 0
    },
    sm: {
      shadowColor: "#111827",
      shadowOpacity: 0.05,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 1
    },
    md: {
      shadowColor: "#111827",
      shadowOpacity: 0.08,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 10 },
      elevation: 3
    }
  }
} as const;

export type ColorToken = keyof typeof tokens.color;
export type SpaceToken = keyof typeof tokens.space;
export type RadiusToken = keyof typeof tokens.radius;
