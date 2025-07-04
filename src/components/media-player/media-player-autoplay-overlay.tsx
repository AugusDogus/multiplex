"use client";

import { useAtom } from "jotai";
import { Button } from "~/components/ui/button";
import { cancelAutoPlayAtom, triggerAutoPlayAtom } from "~/atoms/media-player";
import type { NextEpisodeInfo } from "~/types/media-player";

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
  const [, cancelAutoPlay] = useAtom(cancelAutoPlayAtom);
  const [, triggerAutoPlay] = useAtom(triggerAutoPlayAtom);

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
    <div className="absolute inset-x-4 bottom-20 z-50 flex justify-center">
      <div className="bg-black/90 backdrop-blur-sm rounded-lg p-4 max-w-md w-full">
        <div className="flex items-center justify-between mb-3">
          <div className="flex-1">
            <h3 className="text-white font-medium text-sm">
              Up Next
            </h3>
            <p className="text-gray-300 text-xs">
              {nextEpisode.grandparentTitle && `${nextEpisode.grandparentTitle} • `}
              S{nextEpisode.parentIndex}E{nextEpisode.index} - {nextEpisode.title}
            </p>
          </div>
          <div className="ml-4 text-white font-bold text-lg">
            {countdownSeconds}
          </div>
        </div>
        
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            className="flex-1 text-white border-gray-600 hover:bg-gray-800"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handlePlayNow}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            Play Now
          </Button>
        </div>
      </div>
    </div>
  );
}