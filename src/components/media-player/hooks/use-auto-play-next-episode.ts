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

  // Check if we should fetch next episode info
  const shouldFetchNextEpisode = 
    currentItem?.type === "episode" && 
    duration > 0 && 
    currentTime > 0 && 
    !mediaPlayerState.autoPlay.isCountingDown &&
    // Last 30 seconds of the episode
    (duration - currentTime) <= 30 &&
    (duration - currentTime) > 0;

  // Fetch next episode information
  const { data: nextEpisodeData } = api.plex.getNextEpisode.useQuery(
    {
      serverId: currentItem?.serverId || "",
      currentEpisodeRatingKey: currentItem?.ratingKey || "",
      seasonRatingKey: currentItem?.parentRatingKey || "",
      currentEpisodeIndex: currentItem?.index || 0,
      currentSeasonIndex: currentItem?.parentIndex || 0,
    },
    {
      enabled: shouldFetchNextEpisode,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  );

  // Start countdown when we're in the last 10 seconds and have next episode
  useEffect(() => {
    if (
      !isPlaying ||
      !nextEpisodeData?.found ||
      !nextEpisodeData.episode ||
      mediaPlayerState.autoPlay.isCountingDown ||
      duration <= 0 ||
      currentTime <= 0
    ) {
      return;
    }

    const timeRemaining = duration - currentTime;

    // Start countdown in the last 10 seconds
    if (timeRemaining <= 10 && timeRemaining > 0) {
      startAutoPlayCountdown(nextEpisodeData.episode);
    }
  }, [
    currentTime,
    duration,
    isPlaying,
    nextEpisodeData,
    mediaPlayerState.autoPlay.isCountingDown,
    startAutoPlayCountdown,
  ]);

  return {
    nextEpisode: nextEpisodeData?.episode || null,
    hasNextEpisode: nextEpisodeData?.found || false,
    autoPlayState: mediaPlayerState.autoPlay,
  };
}