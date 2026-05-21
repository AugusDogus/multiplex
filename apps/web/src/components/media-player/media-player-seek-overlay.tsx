"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "~/lib/utils";
import type { SeekOverlayState } from "./hooks/use-seek-overlay";

interface MediaPlayerSeekOverlayProps {
  overlay: SeekOverlayState | null;
}

export function MediaPlayerSeekOverlay({
  overlay,
}: MediaPlayerSeekOverlayProps) {
  if (!overlay) return null;

  const isForward = overlay.direction === "forward";

  return (
    <div
      className={cn(
        "pointer-events-none absolute top-0 bottom-0 z-50 flex w-1/2 items-center max-md:bg-black/20",
        isForward ? "right-0 justify-end pr-16" : "left-0 justify-start pl-16",
      )}
      role="status"
      aria-live="polite"
    >
      <div
        key={overlay.key}
        className="flex items-center gap-2 text-white drop-shadow-md"
      >
        {!isForward && (
          <ChevronLeft
            className="animate-seek-chevron-backward h-7 w-7 shrink-0"
            strokeWidth={2.5}
            aria-hidden="true"
          />
        )}
        <span className="animate-seek-label-in text-xl font-semibold tabular-nums">
          {isForward ? "+" : "-"} {overlay.seconds}
        </span>
        {isForward && (
          <ChevronRight
            className="animate-seek-chevron-forward h-7 w-7 shrink-0"
            strokeWidth={2.5}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}
