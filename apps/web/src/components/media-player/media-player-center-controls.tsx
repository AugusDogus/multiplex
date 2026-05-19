"use client";

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { PointerEvent } from "react";
import { cn } from "~/lib/utils";

/* ────────────────────────────────────────────────────────────
   Media Player Center Controls
   Mobile transport controls (YouTube-style tap-to-reveal)
   ──────────────────────────────────────────────────────────── */

const SKIP_SECONDS = 10;

interface MediaPlayerCenterControlsProps {
  isVisible: boolean;
  isPlaying: boolean;
  disabled?: boolean;
  onTogglePlay: () => void;
  onSkipBackward?: (seconds?: number) => void;
  onSkipForward?: (seconds?: number) => void;
  className?: string;
}

function stopPointerPropagation(event: PointerEvent<HTMLElement>) {
  event.stopPropagation();
}

export function MediaPlayerCenterControls({
  isVisible,
  isPlaying,
  disabled = false,
  onTogglePlay,
  onSkipBackward,
  onSkipForward,
  className = "",
}: MediaPlayerCenterControlsProps) {
  const controlButtonClass = cn(
    "pointer-events-auto flex items-center justify-center rounded-full bg-black/50 text-white shadow-lg ring-1 ring-white/20 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-95 disabled:opacity-50",
  );

  return (
    <div
      className={cn(
        "absolute inset-0 z-40 flex items-center justify-center",
        className,
      )}
      aria-hidden={!isVisible}
    >
      <div className="flex items-center gap-6">
        <button
          type="button"
          onPointerDown={stopPointerPropagation}
          onClick={() => {
            if (disabled) return;
            onSkipBackward?.(SKIP_SECONDS);
          }}
          disabled={disabled}
          aria-label={`Rewind ${SKIP_SECONDS} seconds`}
          className={cn(controlButtonClass, "h-14 w-14")}
        >
          <SkipBack className="h-7 w-7" aria-hidden />
        </button>

        <button
          type="button"
          onPointerDown={stopPointerPropagation}
          onClick={() => {
            if (disabled) return;
            onTogglePlay();
          }}
          disabled={disabled}
          aria-label={isPlaying ? "Pause" : "Play"}
          className={cn(controlButtonClass, "h-20 w-20")}
        >
          {isPlaying ? (
            <Pause
              className="h-10 w-10 fill-white"
              strokeWidth={0}
              aria-hidden
            />
          ) : (
            <Play
              className="ml-1 h-10 w-10 fill-white"
              strokeWidth={0}
              aria-hidden
            />
          )}
        </button>

        <button
          type="button"
          onPointerDown={stopPointerPropagation}
          onClick={() => {
            if (disabled) return;
            onSkipForward?.(SKIP_SECONDS);
          }}
          disabled={disabled}
          aria-label={`Forward ${SKIP_SECONDS} seconds`}
          className={cn(controlButtonClass, "h-14 w-14")}
        >
          <SkipForward className="h-7 w-7" aria-hidden />
        </button>
      </div>
    </div>
  );
}
