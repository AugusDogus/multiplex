"use client";

import type { Marker } from "@multiplex/plex-query";
import { Button } from "~/components/ui/button";

/* ────────────────────────────────────────────────────────────
   Skip Overlay Component
   Shows skip intro/credits buttons when player is in marker range
   ──────────────────────────────────────────────────────────── */

interface MediaPlayerSkipOverlayProps {
  markers: Marker[];
  currentTime: number;
  onSkip: (marker: Marker) => void;
}

function getButtonText(markerType: string) {
  switch (markerType) {
    case "intro":
      return "Skip Intro";
    case "credits":
      return "Skip Credits";
    case "commercial":
      return "Skip Commercial";
    default:
      return "Skip";
  }
}

/**
 * Overlay component that shows skip buttons for intro/credits markers
 * Appears when the current playback time is within a marker's range
 */
export function MediaPlayerSkipOverlay({
  markers,
  currentTime,
  onSkip,
}: MediaPlayerSkipOverlayProps) {
  // Find active marker based on current time (in seconds, markers are in milliseconds)
  const currentTimeMs = currentTime * 1000;
  const activeMarker = markers.find(
    (marker) =>
      currentTimeMs >= marker.startTimeOffset &&
      currentTimeMs <= marker.endTimeOffset,
  );

  if (!activeMarker) {
    return null;
  }

  return (
    <div className="absolute right-[calc(var(--spacing)_*_21)] bottom-24 z-50">
      <Button
        onClick={() => onSkip(activeMarker)}
        className="bg-black/80 text-white transition-colors hover:bg-black/90"
        size="sm"
      >
        {getButtonText(activeMarker.type)}
      </Button>
    </div>
  );
}
