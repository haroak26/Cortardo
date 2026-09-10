import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { useUser } from "@/hooks/use-user";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/ds";

export function ErrorPage() {
  const { data: user } = useUser();
  const isSignedIn = !!user;

  return (
    <div className="h-dvh bg-background flex items-center justify-center px-6">
      <EmptyState
        icon={AlertTriangle}
        iconColor="hsl(var(--amber))"
        iconBg="hsl(38 92% 50% / 0.1)"
        title="Something went wrong"
        description="An unexpected error occurred. Try refreshing the page or come back later."
        actions={
          <div className="flex items-center gap-4">
            <Button design="ghost" size="xs" onClick={() => window.location.reload()}>
              Refresh page
            </Button>
            <span className="text-fg-faint">|</span>
            <Link
              href={isSignedIn ? "/home/inbox" : "/"}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg-muted hover:text-foreground transition-colors no-underline"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {isSignedIn ? "Back to inbox" : "Back to home"}
            </Link>
          </div>
        }
      />
    </div>
  );
}
