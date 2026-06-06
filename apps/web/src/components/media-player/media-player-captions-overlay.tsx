"use client";

import { cn } from "~/lib/utils";
import type { CaptionSize } from "~/types/media-player";

const CAPTION_SIZE_CLASSES: Record<CaptionSize, string> = {
  small: "px-2.5 py-0.5 text-sm",
  medium: "px-3 py-1 text-lg",
  large: "px-3 py-1 text-xl",
  "extra-large": "px-4 py-1.5 text-2xl",
};

interface MediaPlayerCaptionsOverlayProps {
  lines: string[];
  controlsVisible: boolean;
  compactControls?: boolean;
  captionSize?: CaptionSize;
}

export function MediaPlayerCaptionsOverlay({
  lines,
  controlsVisible,
  compactControls = false,
  captionSize = "medium",
}: MediaPlayerCaptionsOverlayProps) {
  if (lines.length === 0) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 z-40 flex justify-center px-6 transition-[bottom] duration-300",
        controlsVisible
          ? compactControls
            ? "bottom-20"
            : "bottom-28"
          : "bottom-8",
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
              CAPTION_SIZE_CLASSES[captionSize],
            )}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
