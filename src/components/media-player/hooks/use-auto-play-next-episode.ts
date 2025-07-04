import { useAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { 
  mediaPlayerStateAtom, 
  startAutoPlayCountdownAtom,
  updatePlaybackStateAtom
} from "~/atoms/media-player";
import type { NextEpisodeInfo } from "~/types/media-player";
import type { PlayQueueItem } from "~/lib/plex.tv/schemas/play-queue-schemas";
import { api } from "~/trpc/react";

/* ────────────────────────────────────────────────────────────
   Auto-Play Next Episode Hook
   Manages detection and triggering of auto-play functionality
   ──────────────────────────────────────────────────────────── */

/**
 * Custom hook that manages auto-play next episode functionality
 * Uses the play queue to find the next episode in sequence
 * Polls for queue updates to handle dynamic changes
 */
export function useAutoPlayNextEpisode() {
  const [mediaPlayerState] = useAtom(mediaPlayerStateAtom);
  const [, startAutoPlayCountdown] = useAtom(startAutoPlayCountdownAtom);
  const [, updateState] = useAtom(updatePlaybackStateAtom);

  const { currentItem, currentTime, duration, isPlaying, playQueue, playQueueId } = mediaPlayerState;

  // Poll for play queue updates when we have a play queue ID
  const { data: updatedPlayQueue } = api.plex.getPlayQueue.useQuery(
    {
      serverId: currentItem?.serverId || "",
      playQueueId: playQueueId || "",
      includeMarkers: true,
    },
    {
      enabled: Boolean(currentItem?.serverId && playQueueId && currentItem?.type === "episode"),
      refetchInterval: 30000, // Poll every 30 seconds
      refetchOnWindowFocus: false,
      staleTime: 15000, // Consider data stale after 15 seconds
    }
  );

  // Update the play queue in state when we get fresh data
  useEffect(() => {
    if (updatedPlayQueue && playQueueId) {
      // Extract markers from the current item in the updated queue
      const currentItemInQueue = updatedPlayQueue.MediaContainer.Metadata?.find(
        (item: PlayQueueItem) => item.ratingKey === currentItem?.ratingKey
      );
      const markers = currentItemInQueue?.Marker ?? [];

      updateState({
        playQueue: updatedPlayQueue,
        markers,
      });
    }
  }, [updatedPlayQueue, playQueueId, currentItem?.ratingKey, updateState]);

  // Use the most recent play queue data (either from state or polling)
  const activePlayQueue = updatedPlayQueue || playQueue;

  // Find next episode from play queue
  const nextEpisode = useMemo((): NextEpisodeInfo | null => {
    // Only work with episodes and when we have a play queue
    if (currentItem?.type !== "episode" || !activePlayQueue?.MediaContainer?.Metadata) {
      return null;
    }

    const episodes = activePlayQueue.MediaContainer.Metadata;
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
  }, [currentItem, activePlayQueue]);

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

    // Check if we're near the end (last 30 seconds)
    const timeRemaining = duration - currentTime;
    const isNearEnd = timeRemaining <= 30 && timeRemaining > 0;

    if (isNearEnd) {
      // Start countdown when we're in the last 5 seconds OR if manually seeked to the end
      if (timeRemaining <= 5) {
        // Calculate actual countdown time (max 5 seconds, but could be less if seeked to very end)
        const countdownTime = Math.min(Math.max(Math.floor(timeRemaining), 1), 5);
        startAutoPlayCountdown({ nextEpisode, countdownSeconds: countdownTime });
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
    // Expose queue polling status for debugging
    isPollingQueue: Boolean(currentItem?.serverId && playQueueId && currentItem?.type === "episode"),
  };
}