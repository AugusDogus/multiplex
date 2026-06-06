"use client";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import type { NextEpisodeInfo } from "~/types/media-player";
import { PLAYER_OVERLAY_BOTTOM_COMPACT_CONTROLS } from "./utils/player-overlay-layout";

/* ────────────────────────────────────────────────────────────
   Auto-Play Overlay Component
   Shows countdown and controls for auto-playing next episode
   ──────────────────────────────────────────────────────────── */

interface MediaPlayerAutoPlayOverlayProps {
  isCountingDown: boolean;
  countdownSeconds: number;
  nextEpisode: NextEpisodeInfo | null;
}

/**
 * Overlay component that shows auto-play countdown and controls
 * Appears when nearing the end of a TV episode with a next episode available
 */
export function MediaPlayerAutoPlayOverlay({
  isCountingDown,
  countdownSeconds,
  nextEpisode,
}: MediaPlayerAutoPlayOverlayProps) {
  const { cancelAutoPlay, triggerAutoPlay } = useMediaPlayerStore();

  if (!isCountingDown || !nextEpisode) {
    return null;
  }

  const handlePlayNow = () => {
    triggerAutoPlay(nextEpisode);
  };

  const handleCancel = () => {
    cancelAutoPlay();
  };

  return (
    <div
      className={cn(
        "absolute inset-x-4 z-50 flex justify-center",
        PLAYER_OVERLAY_BOTTOM_COMPACT_CONTROLS,
      )}
    >
      <div className="w-full max-w-md rounded-lg bg-black/90 p-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex-1">
            <h3 className="text-sm font-medium text-white">Up Next</h3>
            <p className="text-xs text-gray-300">
              {nextEpisode.grandparentTitle &&
                `${nextEpisode.grandparentTitle} • `}
              S{nextEpisode.parentIndex}E{nextEpisode.index} -{" "}
              {nextEpisode.title}
            </p>
          </div>
          <div className="ml-4 text-lg font-bold text-white">
            {countdownSeconds}
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            className="flex-1 border-gray-600 text-white hover:bg-gray-800"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handlePlayNow}
            className="flex-1 bg-blue-600 text-white hover:bg-blue-700"
          >
            Play Now
          </Button>
        </div>
      </div>
    </div>
  );
}
