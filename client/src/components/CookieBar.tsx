import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/button";

const COOKIE_CONSENT_KEY = "cortardo_cookie_consent";

export function CookieBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(COOKIE_CONSENT_KEY)) setVisible(true);
    } catch {}
  }, []);

  const accept = () => { try { localStorage.setItem(COOKIE_CONSENT_KEY, "accepted"); } catch {} setVisible(false); };
  const decline = () => { try { localStorage.setItem(COOKIE_CONSENT_KEY, "dismissed"); } catch {} setVisible(false); };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background border-border/60 pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-[1060px] mx-auto px-6 md:px-8 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p className="flex-1 text-[12px] font-medium leading-[1.6] text-muted-foreground">
          We use cookies to keep Cortardo running smoothly and improve your experience. See our{" "}
          <Link href="/privacy" className="underline underline-offset-2 transition-colors hover:text-foreground text-foreground/70">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="underline underline-offset-2 transition-colors hover:text-foreground text-foreground/70">
            Terms of Service
          </Link>{" "}
          for details.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Button design="pill-ghost" size="xs" onClick={decline}>
            Decline
          </Button>
          <Button design="pill" size="xs" onClick={accept}>
            Accept all
          </Button>
        </div>
      </div>
    </div>
  );
}
