"use client";

import { cn } from "~/lib/utils";
import type { CaptionSize } from "~/types/media-player";
import { CAPTION_SIZES } from "./utils/caption-size";
import {
  PLAYER_OVERLAY_BOTTOM_COMPACT_CONTROLS,
  PLAYER_OVERLAY_BOTTOM_CONTROLS,
  PLAYER_OVERLAY_BOTTOM_IDLE,
} from "./utils/player-overlay-layout";

interface MediaPlayerCaptionsOverlayProps {
  lines: string[];
  controlsVisible: boolean;
  compactControls?: boolean;
  captionSize: CaptionSize;
}

export function MediaPlayerCaptionsOverlay({
  lines,
  controlsVisible,
  compactControls = false,
  captionSize,
}: MediaPlayerCaptionsOverlayProps) {
  if (lines.length === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 z-40 flex justify-center px-6 transition-[bottom] duration-300",
        controlsVisible
          ? compactControls
            ? PLAYER_OVERLAY_BOTTOM_COMPACT_CONTROLS
            : PLAYER_OVERLAY_BOTTOM_CONTROLS
          : PLAYER_OVERLAY_BOTTOM_IDLE,
      )}
      aria-live="polite"
      role="region"
      aria-label="Subtitles"
    >
      <div className="flex max-w-[85%] flex-col items-center gap-1 text-center">
        {lines.map((line, index) => (
          <p
            key={`${index}-${line}`}
            className={cn(
              "rounded-sm bg-black/75 leading-snug font-medium tracking-wide whitespace-pre-line text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]",
              CAPTION_SIZES[captionSize].className,
            )}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
