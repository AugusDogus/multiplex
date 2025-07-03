"use client";

import React from "react";
import { Button } from "~/components/ui/button";
import type { Marker } from "~/lib/plex.tv/schemas/play-queue-schemas";

/* ────────────────────────────────────────────────────────────
   Skip Overlay Component
   Shows skip intro/credits buttons when player is in marker range
   ──────────────────────────────────────────────────────────── */

interface MediaPlayerSkipOverlayProps {
  markers: Marker[];
  currentTime: number;
  onSkip: (marker: Marker) => void;
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

  // Determine button text based on marker type
  const getButtonText = (markerType: string) => {
    switch (markerType) {
      case 'intro':
        return 'Skip Intro';
      case 'credits':
        return 'Skip Credits';
      case 'commercial':
        return 'Skip Commercial';
      default:
        return 'Skip';
    }
  };

  return (
    <div className="absolute top-4 right-4 z-50">
      <Button
        onClick={() => onSkip(activeMarker)}
        className="bg-black/80 text-white hover:bg-black/90 transition-colors"
        size="sm"
      >
        {getButtonText(activeMarker.type)}
      </Button>
    </div>
  );
}