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
    <div className="absolute inset-x-0 bottom-24 z-50 flex justify-center">
      <div className="mx-auto max-w-md rounded-lg bg-black/90 p-6 text-white shadow-xl backdrop-blur-sm">
        <div className="text-center">
          <div className="mb-2 text-sm text-gray-300">Up Next</div>
          
          <div className="mb-1 font-semibold">
            {nextEpisode.grandparentTitle}
          </div>
          
          <div className="mb-1 text-sm text-gray-300">
            {nextEpisode.parentTitle && `${nextEpisode.parentTitle} • `}
            Episode {nextEpisode.index}: {nextEpisode.title}
          </div>

          <div className="mb-4 text-xs text-gray-400">
            Auto-playing in {countdownSeconds} second{countdownSeconds !== 1 ? 's' : ''}
          </div>

          <div className="flex justify-center gap-3">
            <Button
              onClick={handleCancel}
              variant="outline"
              size="sm"
              className="border-gray-600 bg-transparent text-white hover:bg-gray-700"
            >
              Cancel
            </Button>
            
            <Button
              onClick={handlePlayNow}
              size="sm"
              className="bg-white text-black hover:bg-gray-200"
            >
              Play Now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}