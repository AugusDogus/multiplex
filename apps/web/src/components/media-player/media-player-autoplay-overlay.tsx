"use client";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { playerCommands } from "~/lib/effect/player-atoms";
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
  /**
   * Hide the Cancel / Play Now buttons. Watch Together auto-advance is a
   * group action driven by the room, so an individual can't cancel or skip
   * ahead — the overlay is purely informational there.
   */
  showActions?: boolean;
}

function handleCancel() {
  playerCommands.cancelAutoPlay();
}

/**
 * Overlay component that shows auto-play countdown and controls
 * Appears when nearing the end of a TV episode with a next episode available
 */
export function MediaPlayerAutoPlayOverlay({
  isCountingDown,
  countdownSeconds,
  nextEpisode,
  showActions = true,
}: MediaPlayerAutoPlayOverlayProps) {
  if (!isCountingDown || !nextEpisode) {
    return null;
  }

  const handlePlayNow = () => {
    playerCommands.triggerAutoPlay(nextEpisode);
  };

  return (
    <div
      className={cn(
        "absolute inset-x-4 z-50 flex justify-center",
        PLAYER_OVERLAY_BOTTOM_COMPACT_CONTROLS,
      )}
    >
      <div className="animate-in fade-in-0 slide-in-from-bottom-2 w-full max-w-md rounded-lg bg-black/90 p-4 backdrop-blur-sm duration-200 ease-out">
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

        {showActions && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleCancel}
              className="flex-1 border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handlePlayNow} className="flex-1">
              Play Now
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
