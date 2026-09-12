import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(async (): Promise<import("vite").UserConfig> => {
  const replitPlugins = [];
  const isReplit = !!process.env.REPL_ID || !!process.env.REPLIT_DEV_DOMAIN;
  if (isReplit) {
    try {
      const { cartographer } = await import("@replit/vite-plugin-cartographer");
      const { devBanner } = await import("@replit/vite-plugin-dev-banner");
      const { default: runtimeErrorModal } = await import("@replit/vite-plugin-runtime-error-modal");
      replitPlugins.push(cartographer(), devBanner(), runtimeErrorModal());
    } catch {}
  }

  return {
    plugins: [react(), ...replitPlugins],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
      },
      // Keep React and its renderer on one module instance in dev and preview,
      // including the subpath entry points the app imports directly.
      dedupe: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
      ],
    },
    root: path.resolve(import.meta.dirname, "client"),
    optimizeDeps: {
      // Prebundle every dependency used by the initial app shell together.
      // Otherwise Vite changes the browser hash while crawling lazy imports,
      // leaving React and its renderer loaded from different graphs.
      // NOTE: do NOT set `force: true` here. Forcing a full dep re-optimization
      // on every dev-server start races the first page load, which can serve a
      // mix of old and new dep chunks and duplicate React ("Invalid hook call"
      // -> blank screen) until the cache is rebuilt.
      include: [
        // React core
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",

        // Routing / data / telemetry
        "wouter",
        "@tanstack/react-query",
        "@tanstack/react-query-persist-client",
        "@tanstack/query-sync-storage-persister",
        "@vercel/analytics/react",
        "@vercel/speed-insights/react",

        // UI component libraries (React-consuming)
        "@base-ui/react",
        "@base-ui/react/accordion",
        "@base-ui/react/alert-dialog",
        "@base-ui/react/avatar",
        "@base-ui/react/button",
        "@base-ui/react/checkbox",
        "@base-ui/react/collapsible",
        "@base-ui/react/context-menu",
        "@base-ui/react/dialog",
        "@base-ui/react/drawer",
        "@base-ui/react/input",
        "@base-ui/react/menu",
        "@base-ui/react/merge-props",
        "@base-ui/react/popover",
        "@base-ui/react/preview-card",
        "@base-ui/react/progress",
        "@base-ui/react/radio",
        "@base-ui/react/radio-group",
        "@base-ui/react/scroll-area",
        "@base-ui/react/select",
        "@base-ui/react/separator",
        "@base-ui/react/slider",
        "@base-ui/react/switch",
        "@base-ui/react/tabs",
        "@base-ui/react/toggle",
        "@base-ui/react/toggle-group",
        "@base-ui/react/tooltip",
        "@base-ui/react/use-render",
        "@radix-ui/react-accordion",
        "@radix-ui/react-aspect-ratio",
        "@radix-ui/react-avatar",
        "@radix-ui/react-checkbox",
        "@radix-ui/react-collapsible",
        "@radix-ui/react-context-menu",
        "@radix-ui/react-dialog",
        "@radix-ui/react-hover-card",
        "@radix-ui/react-label",
        "@radix-ui/react-menubar",
        "@radix-ui/react-navigation-menu",
        "@radix-ui/react-popover",
        "@radix-ui/react-progress",
        "@radix-ui/react-radio-group",
        "@radix-ui/react-scroll-area",
        "@radix-ui/react-separator",
        "@radix-ui/react-slider",
        "@radix-ui/react-slot",
        "@radix-ui/react-switch",
        "@radix-ui/react-tabs",
        "@radix-ui/react-toast",
        "@radix-ui/react-toggle",
        "@radix-ui/react-toggle-group",
        "@radix-ui/react-tooltip",
        "sonner",
        "next-themes",
        "vaul",
        "cmdk",
        "input-otp",
        "react-hook-form",
        "react-resizable-panels",
        "react-day-picker",
        "recharts",
        "embla-carousel-react",
        "embla-carousel-autoplay",

        // Motion / icons / utils
        "framer-motion",
        "@hugeicons/react",
        "@hugeicons/core-free-icons",
        "lucide-react",
        "class-variance-authority",
        "clsx",
        "dompurify",
        "marked",
        "tailwind-merge",
        "tailwindcss-animate",
        "zod",
        "drizzle-orm/pg-core",
        "drizzle-zod",
      ],
    },
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  };
});
