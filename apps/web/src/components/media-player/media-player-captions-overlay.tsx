"use client";

import { cn } from "~/lib/utils";

interface MediaPlayerCaptionsOverlayProps {
  lines: string[];
  controlsVisible: boolean;
  compactControls?: boolean;
}

export function MediaPlayerCaptionsOverlay({
  lines,
  controlsVisible,
  compactControls = false,
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
            className="rounded-sm bg-black/75 px-3 py-1 text-lg leading-snug font-medium tracking-wide text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)] whitespace-pre-line"
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
