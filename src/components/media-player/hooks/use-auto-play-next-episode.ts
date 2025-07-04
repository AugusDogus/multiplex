import { useAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { 
  mediaPlayerStateAtom, 
  startAutoPlayCountdownAtom,
  triggerAutoPlayAtom,
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
  const [, triggerAutoPlay] = useAtom(triggerAutoPlayAtom);
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
    // Don't trigger if no next episode found
    if (!nextEpisode) {
      return;
    }

    // Don't trigger if already counting down
    if (mediaPlayerState.autoPlay.isCountingDown) {
      return;
    }

    // Guard against invalid duration or very early in playback
    if (duration <= 0 || currentTime < 5) {
      return;
    }

    // Calculate time remaining
    const timeRemaining = duration - currentTime;
    
    // Additional safety check - don't trigger if timeRemaining doesn't make sense
    if (timeRemaining < 0 || timeRemaining > duration) {
      return;
    }
    
    // Check if we're at the very end (within 0.5 seconds) - handles skip credits to end
    const isAtVeryEnd = timeRemaining <= 0.5 && timeRemaining >= 0;
    
    // Check if we're near the end (last 30 seconds) and actively playing
    const isNearEndAndPlaying = isPlaying && timeRemaining <= 30 && timeRemaining > 0.5;

    if (isAtVeryEnd) {
      // At the very end - immediately play next episode (no countdown for skip/seek to end)
      triggerAutoPlay(nextEpisode);
    } else if (isNearEndAndPlaying) {
      // Normal case - start countdown when we're in the last 5 seconds while playing
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
    triggerAutoPlay,
  ]);

  return {
    autoPlayState: mediaPlayerState.autoPlay,
    hasNextEpisode: Boolean(nextEpisode),
    nextEpisode: nextEpisode,
    // Expose queue polling status for debugging
    isPollingQueue: Boolean(currentItem?.serverId && playQueueId && currentItem?.type === "episode"),
  };
}