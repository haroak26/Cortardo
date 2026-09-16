import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "10px",
        xl: "12px",
        "2xl": "15px",
        "3xl": "20px",
      },
      colors: {
        brand: {
          DEFAULT: "hsl(var(--brand) / <alpha-value>)",
          foreground: "hsl(var(--brand-foreground) / <alpha-value>)",
        },
        blue: {
          DEFAULT: "hsl(var(--blue) / <alpha-value>)",
          muted: "hsl(var(--blue-muted) / <alpha-value>)",
          border: "hsl(var(--blue-border) / <alpha-value>)",
          hover: "hsl(var(--blue-hover) / <alpha-value>)",
        },
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
          border: "hsl(var(--card-border) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
          border: "hsl(var(--popover-border) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          border: "var(--primary-border)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
          border: "var(--secondary-border)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
          border: "var(--muted-border)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
          border: "var(--accent-border)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          border: "var(--destructive-border)",
        },
        ring: "hsl(var(--ring) / <alpha-value>)",
        surface: "hsl(var(--surface) / <alpha-value>)",
        "surface-hover": "hsl(var(--surface-hover) / <alpha-value>)",
        "surface-hover-strong": "hsl(var(--surface-hover-strong) / <alpha-value>)",
        "surface-active": "hsl(var(--surface-active) / <alpha-value>)",
        "surface-muted": "hsl(var(--surface-muted) / <alpha-value>)",
        "surface-subtle": "hsl(var(--surface-subtle) / <alpha-value>)",
        "surface-deep": "hsl(var(--surface-deep) / <alpha-value>)",
        "border-subtle": "hsl(var(--border-subtle) / <alpha-value>)",
        "border-strong": "hsl(var(--border-strong) / <alpha-value>)",
        "fg-strong": "hsl(var(--fg-strong) / <alpha-value>)",
        "fg-soft": "hsl(var(--fg-soft) / <alpha-value>)",
        "fg-muted": "hsl(var(--fg-muted) / <alpha-value>)",
        "fg-secondary": "hsl(var(--fg-secondary) / <alpha-value>)",
        "fg-subtle": "hsl(var(--fg-subtle) / <alpha-value>)",
        "fg-faint": "hsl(var(--fg-faint) / <alpha-value>)",
        "fg-warm": "hsl(var(--fg-warm) / <alpha-value>)",
        "toggle-on": "hsl(var(--toggle-on) / <alpha-value>)",
        success: "hsl(var(--success) / <alpha-value>)",
        warning: "hsl(var(--warning) / <alpha-value>)",
        danger: "hsl(var(--danger) / <alpha-value>)",
        info: "hsl(var(--info) / <alpha-value>)",
        chart: {
          "1": "hsl(var(--chart-1) / <alpha-value>)",
          "2": "hsl(var(--chart-2) / <alpha-value>)",
          "3": "hsl(var(--chart-3) / <alpha-value>)",
          "4": "hsl(var(--chart-4) / <alpha-value>)",
          "5": "hsl(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          ring: "hsl(var(--sidebar-ring) / <alpha-value>)",
          DEFAULT: "hsl(var(--sidebar) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-foreground) / <alpha-value>)",
          border: "hsl(var(--sidebar-border) / <alpha-value>)",
        },
        "sidebar-primary": {
          DEFAULT: "hsl(var(--sidebar-primary) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-primary-foreground) / <alpha-value>)",
          border: "var(--sidebar-primary-border)",
        },
        "sidebar-accent": {
          DEFAULT: "hsl(var(--sidebar-accent) / <alpha-value>)",
          foreground: "hsl(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "var(--sidebar-accent-border)",
        },
        status: {
          online: "rgb(34 197 94)",
          away: "rgb(245 158 11)",
          busy: "rgb(239 68 68)",
          offline: "rgb(156 163 175)",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)"],
      },
      spacing: {
        sidebar: "260px",
        "page-max": "1060px",
        "page-narrow": "720px",
        "header-h": "56px",
      },
      maxWidth: {
        page: "1060px",
        "page-narrow": "720px",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgba(0, 0, 0, 0.04)",
        floating: "0 2px 16px 0 rgba(0,0,0,0.06)",
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
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
      ringWidth: {
        3: "3px",
      },
      transitionDuration: {
        450: "450ms",
        // Drawer close/swipe animation, driven by Base UI swipe strength.
        "drawer-close": "calc(var(--drawer-swipe-strength, 1) * 400ms)",
      },
      transitionTimingFunction: {
        drawer: "cubic-bezier(0.32, 0.72, 0, 1)",
        spring: "cubic-bezier(0.22, 1, 0.36, 1)",
        panel: "cubic-bezier(0.45, 1.005, 0, 1.005)",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
    plugin(function ({ matchVariant, addVariant }) {
      // ── Tailwind v4-style dynamic variants used by the base-nova (shadcn preset b0)
      //    base components in client/src/components/base ────────────────────────────
      addVariant("data-open", '&:where([data-state="open"], [data-open]:not([data-open="false"]))');
      addVariant("data-closed", '&:where([data-state="closed"], [data-closed]:not([data-closed="false"]))');
      addVariant("data-checked", '&:where([data-state="checked"], [data-checked]:not([data-checked="false"]))');
      addVariant("data-unchecked", '&:where([data-state="unchecked"], [data-unchecked]:not([data-unchecked="false"]))');
      addVariant("data-selected", '&:where([data-selected="true"])');
      addVariant("data-disabled", '&:where([data-disabled="true"], [data-disabled]:not([data-disabled="false"]))');
      addVariant("data-active", '&:where([data-state="active"], [data-active]:not([data-active="false"]))');
      addVariant("data-horizontal", '&:where([data-orientation="horizontal"])');
      addVariant("data-vertical", '&:where([data-orientation="vertical"])');
      addVariant("data-inset", "&:where([data-inset])");
      addVariant("data-popup-open", "&:where([data-popup-open])");
      addVariant("data-placeholder", "&:where([data-placeholder])");
      addVariant("data-ending-style", "&:where([data-ending-style])");
      addVariant("data-starting-style", "&:where([data-starting-style])");
      addVariant("data-swiping", "&:where([data-swiping])");
      addVariant("data-nested-drawer-open", "&:where([data-nested-drawer-open])");
      addVariant("data-nested-drawer-swiping", "&:where([data-nested-drawer-swiping])");
      addVariant("data-snap-points", "&:where([data-snap-points])");
      addVariant("not-last", "&:not(:last-child)");
      matchVariant("has-data", (value) => `&:has([data-${value}])`);
      matchVariant("has-aria", (value) => `&:has([aria-${value}])`);
      matchVariant("in-data", (value) => `&:is([data-${value}] *)`);
      matchVariant("not-data", (value) => `&:not([data-${value}])`);
      matchVariant("not", (value) => `&:not(${value})`);
      matchVariant(
        "group-has-data",
        (value, { modifier }) => `:merge(.group\\/${modifier}):has([data-${value}]) &`
      );
    }),
  ],
} satisfies Config;
