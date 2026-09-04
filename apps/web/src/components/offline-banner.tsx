"use client";

import { WifiOff } from "lucide-react";
import { useOffline } from "next/offline";

/**
 * Surfaces Next's offline detection (`experimental.useOffline`). While this is
 * visible, failed soft navigations and Server Actions stay pending and retry
 * automatically once connectivity returns; direct fetches (tRPC/TanStack
 * Query, video streams) keep their own retry policies.
 */
export function OfflineBanner() {
  const isOffline = useOffline();

  if (!isOffline) return null;

  return (
    <div
      role="status"
      className="bg-popover text-popover-foreground fixed top-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border px-3.5 py-2 text-sm shadow-lg/5"
    >
      <WifiOff className="text-warning size-4 shrink-0" aria-hidden />
      <span>Offline, waiting to reconnect</span>
    </div>
  );
}
