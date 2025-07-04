import { useAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { 
  mediaPlayerStateAtom, 
  startAutoPlayCountdownAtom 
} from "~/atoms/media-player";
import type { NextEpisodeInfo } from "~/types/media-player";
import type { PlayQueueItem } from "~/lib/plex.tv/schemas/play-queue-schemas";

/* ────────────────────────────────────────────────────────────
   Auto-Play Next Episode Hook
   Manages detection and triggering of auto-play functionality
   ──────────────────────────────────────────────────────────── */

/**
 * Custom hook that manages auto-play next episode functionality
 * Uses the play queue to find the next episode in sequence
 */
export function useAutoPlayNextEpisode() {
  const [mediaPlayerState] = useAtom(mediaPlayerStateAtom);
  const [, startAutoPlayCountdown] = useAtom(startAutoPlayCountdownAtom);

  const { currentItem, currentTime, duration, isPlaying, playQueue } = mediaPlayerState;

  // Find next episode from play queue
  const nextEpisode = useMemo((): NextEpisodeInfo | null => {
    // Only work with episodes and when we have a play queue
    if (currentItem?.type !== "episode" || !playQueue?.MediaContainer?.Metadata) {
      return null;
    }

    const episodes = playQueue.MediaContainer.Metadata;
    const currentIndex = episodes.findIndex(
      (episode: PlayQueueItem) => episode.ratingKey === currentItem.ratingKey
    );

    // If current episode not found or is the last episode, no next episode
    if (currentIndex === -1 || currentIndex >= episodes.length - 1) {
      return null;
    }

    const nextEpisodeData = episodes[currentIndex + 1];
    if (!nextEpisodeData) {
      return null;
    }

    // Convert play queue item to NextEpisodeInfo format
    return {
      ratingKey: nextEpisodeData.ratingKey,
      key: nextEpisodeData.key,
      title: nextEpisodeData.title,
      index: nextEpisodeData.index || 0,
      parentIndex: nextEpisodeData.parentIndex || 0,
      thumb: nextEpisodeData.thumb,
      art: nextEpisodeData.art,
      duration: nextEpisodeData.duration || 0,
      grandparentTitle: nextEpisodeData.grandparentTitle || "",
      parentTitle: nextEpisodeData.parentTitle || "",
    };
  }, [currentItem, playQueue]);

  // Auto-play logic
  useEffect(() => {
    // Don't trigger if not playing or no next episode found
    if (!isPlaying || !nextEpisode) {
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
        startAutoPlayCountdown(nextEpisode);
      }
    }
  }, [
    isPlaying,
    currentTime,
    duration,
    nextEpisode,
    mediaPlayerState.autoPlay.isCountingDown,
    startAutoPlayCountdown,
  ]);

  return {
    autoPlayState: mediaPlayerState.autoPlay,
    hasNextEpisode: Boolean(nextEpisode),
    nextEpisode: nextEpisode,
  };
}