import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        // Quoted inside the string: unquoted, "Source Serif 4" is not a valid
        // CSS family name (a token cannot start with a digit) and the whole
        // font-serif declaration would be dropped.
        serif: ['"Source Serif 4"', 'Georgia', 'serif'],
      },
      maxWidth: {
        site: "1200px",
      },
      boxShadow: {
        "pn-card": "0 1px 0 rgba(28,26,22,0.04), 0 10px 30px -16px rgba(28,26,22,0.22)",
        "pn-float": "0 2px 4px rgba(28,26,22,0.05), 0 24px 48px -20px rgba(28,26,22,0.32)",
        "pn-phone": "0 50px 90px -40px rgba(28,26,22,0.55), 0 20px 40px -24px rgba(28,26,22,0.35)",
      },
      colors: {
        // The PersoNewsAP landing palette — the mobile app's own tokens
        // (apps/mobile/src/design/tokens.ts + theme.ts), so the site and the
        // product read as one object. `blue` is the app icon's colour, kept
        // for the mark only.
        pn: {
          paper: "#F5F1E8",
          raised: "#FBF8F1",
          surface: "#FCFAF4",
          sunk: "#EFEBE1",
          ink: "#1C1A16",
          "ink-soft": "#4A463D",
          muted: "#6E685C",
          line: "#E6E0D3",
          "line-strong": "#D2CABA",
          teal: "#0F5B5F",
          "teal-deep": "#0A4649",
          "teal-soft": "#E7EFEC",
          "teal-ink": "#0B4144",
          gold: "#9C7B3F",
          "gold-soft": "#EFE7D6",
          success: "#3F7A5B",
          "success-soft": "#E6EEE7",
          blue: "#0A6BE8",
          night: "#16140F",
          "night-raised": "#221F17",
          "night-line": "#332F25",
          "night-ink": "#F2ECDD",
          "night-soft": "#C9C2B0",
          "night-teal": "#5CB0A9",
          "night-gold": "#C8A463",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        selection: {
          border: "hsl(var(--selection-border))",
          bg: "hsl(var(--selection-bg))",
        },
        progress: {
          bg: "hsl(var(--progress-bg))",
          fill: "hsl(var(--progress-fill))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "slide-in": "slide-in 0.3s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
