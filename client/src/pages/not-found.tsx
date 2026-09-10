import { Link } from "wouter";
import { FileQuestion, ArrowLeft } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { EmptyState } from "@/components/ds";

export default function NotFound() {
  const { data: user } = useUser();
  const isSignedIn = !!user;

  return (
    <div className="h-dvh bg-background flex items-center justify-center px-6">
      <EmptyState
        icon={FileQuestion}
        iconColor="#6B7280"
        iconBg="hsl(220 14% 91% / 0.6)"
        title="Page not found"
        description="The page you're looking for doesn't exist or has been moved."
        actions={
          <Link
            href={isSignedIn ? "/home/inbox" : "/"}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-fg-muted hover:text-foreground transition-colors no-underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {isSignedIn ? "Back to inbox" : "Back to home"}
          </Link>
        }
      />
    </div>
  );
}
