import { WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/button";
import { StatusPage } from "@/components/StatusPage";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

export function OfflinePage() {
  const { refresh } = useNetworkStatus();

  return (
    <StatusPage
      icon={<WifiOff className="h-24 w-24" strokeWidth={1.5} />}
      title="No internet connection"
      description="You appear to be offline. Check your connection and try again."
      actions={
        <Button onClick={refresh}>
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      }
    />
  );
}
