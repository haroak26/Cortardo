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
      // Keep React and its renderer on one module instance in dev and preview.
      dedupe: ["react", "react-dom"],
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
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "wouter",
        "@tanstack/react-query",
        "@tanstack/react-query-persist-client",
        "@tanstack/query-sync-storage-persister",
        "@vercel/analytics/react",
        "@vercel/speed-insights/react",
        "@radix-ui/react-toast",
        "@radix-ui/react-tooltip",
        "@radix-ui/react-switch",
        "class-variance-authority",
        "clsx",
        "dompurify",
        "drizzle-orm/pg-core",
        "drizzle-zod",
        "framer-motion",
        "@hugeicons/react",
        "@hugeicons/core-free-icons",
        "lucide-react",
        "marked",
        "tailwind-merge",
        "tailwindcss-animate",
        "zod",
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
