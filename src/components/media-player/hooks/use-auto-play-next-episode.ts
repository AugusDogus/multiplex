import { useAtom } from "jotai";
import { useEffect } from "react";
import { api } from "~/trpc/react";
import { 
  mediaPlayerStateAtom, 
  startAutoPlayCountdownAtom 
} from "~/atoms/media-player";

/* ────────────────────────────────────────────────────────────
   Auto-Play Next Episode Hook
   Manages detection and triggering of auto-play functionality
   ──────────────────────────────────────────────────────────── */

/**
 * Custom hook that manages auto-play next episode functionality
 * Detects when current episode is near completion and fetches next episode info
 */
export function useAutoPlayNextEpisode() {
  const [mediaPlayerState] = useAtom(mediaPlayerStateAtom);
  const [, startAutoPlayCountdown] = useAtom(startAutoPlayCountdownAtom);

  const { currentItem, currentTime, duration, isPlaying } = mediaPlayerState;

  // Only attempt to get next episode for TV episodes
  const isEpisode = currentItem?.type === "episode";
  const hasRequiredData = Boolean(
    currentItem?.parentRatingKey && // season rating key
    currentItem?.index && // episode index
    currentItem?.parentIndex // season index
  );

  // Query for next episode information
  const { data: nextEpisodeData } = api.plex.getNextEpisode.useQuery(
    {
      serverId: currentItem?.serverId || "",
      currentEpisodeRatingKey: currentItem?.ratingKey || "",
      seasonRatingKey: currentItem?.parentRatingKey || "",
      currentEpisodeIndex: currentItem?.index || 0,
      currentSeasonIndex: currentItem?.parentIndex || 0,
    },
    {
      enabled: isEpisode && hasRequiredData && Boolean(currentItem?.serverId),
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  );

  // Auto-play logic
  useEffect(() => {
    // Don't trigger if not playing or no next episode found
    if (!isPlaying || !nextEpisodeData?.found || !nextEpisodeData.episode) {
      return;
    }

    // Don't trigger if already counting down
    if (mediaPlayerState.autoPlay.isCountingDown) {
      return;
    }

    // Check if we're in the last 30 seconds
    const timeRemaining = duration - currentTime;
    const isNearEnd = timeRemaining <= 30 && timeRemaining > 0;

    if (isNearEnd) {
      // Start countdown when 5 seconds remaining
      if (timeRemaining <= 5) {
        startAutoPlayCountdown(nextEpisodeData.episode);
      }
    }
  }, [
    isPlaying,
    currentTime,
    duration,
    nextEpisodeData,
    mediaPlayerState.autoPlay.isCountingDown,
    startAutoPlayCountdown,
  ]);

  return {
    autoPlayState: mediaPlayerState.autoPlay,
    hasNextEpisode: Boolean(nextEpisodeData?.found),
    nextEpisode: nextEpisodeData?.episode || null,
  };
}