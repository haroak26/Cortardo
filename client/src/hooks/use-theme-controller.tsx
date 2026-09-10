import { useEffect } from "react";
import { useLocation } from "wouter";
import { useUser } from "@/hooks/use-user";

function isAuthRoute(path: string): boolean {
  return path.startsWith("/auth/");
}

function isMarketingRoute(path: string): boolean {
  if (path.startsWith("/home/")) return false;
  if (path.startsWith("/account")) return false;
  if (path.startsWith("/workspace")) return false;
  if (path.startsWith("/create/")) return false;
  if (path === "/admin" || path.startsWith("/admin/") && path !== "/admin/login") return false;
  if (isAuthRoute(path)) return false;
  return true;
}

export function ThemeController() {
  const [location] = useLocation();
  const { data: user, isLoading } = useUser();

  useEffect(() => {
    const root = document.documentElement;
    const isMarketing = isMarketingRoute(location);

    if (isAuthRoute(location)) {
      root.classList.remove("dark", "marketing-dark");
      return;
    }

    if (isMarketing) {
      root.classList.remove("dark", "marketing-dark");
      return;
    }

    root.classList.remove("marketing-dark");

    if (isLoading) return;

    const theme = user?.theme || "system";

    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.matches) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
      const handler = (e: MediaQueryListEvent) => {
        if (e.matches) root.classList.add("dark");
        else root.classList.remove("dark");
      };
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [location, user?.theme, isLoading]);

  return null;
}
