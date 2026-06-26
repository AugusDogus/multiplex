"use client";

import { useEffect, useMemo } from "react";
import type { PlayQueueItem } from "@multiplex/plex-query";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import type { NextEpisodeInfo } from "~/types/media-player";
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
export function useAutoPlayNextEpisode(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const currentItem = useMediaPlayerStore((state) => state.currentItem);
  const currentTime = useMediaPlayerStore((state) => state.currentTime);
  const duration = useMediaPlayerStore((state) => state.duration);
  const isPlaying = useMediaPlayerStore((state) => state.isPlaying);
  const playQueue = useMediaPlayerStore((state) => state.playQueue);
  const playQueueId = useMediaPlayerStore((state) => state.playQueueId);
  const autoPlay = useMediaPlayerStore((state) => state.autoPlay);

  const {
    startAutoPlayCountdown,
    triggerAutoPlay,
    updatePlaybackState,
    updateCountdownSeconds,
  } = useMediaPlayerStore();

  // Poll for play queue updates when we have a play queue ID
  const { data: updatedPlayQueue } = api.plex.getPlayQueue.useQuery(
    {
      serverId: currentItem?.serverId ?? "",
      playQueueId: playQueueId ?? "",
      includeMarkers: true,
    },
    {
      enabled: Boolean(
        currentItem?.serverId && playQueueId && currentItem?.type === "episode",
      ),
      refetchInterval: 30000, // Poll every 30 seconds
      refetchOnWindowFocus: false,
      staleTime: 15000, // Consider data stale after 15 seconds
    },
  );

  // Update the play queue in state when we get fresh data
  useEffect(() => {
    if (updatedPlayQueue && playQueueId) {
      // Extract markers from the current item in the updated queue
      const currentItemInQueue = updatedPlayQueue.MediaContainer.Metadata?.find(
        (item: PlayQueueItem) => item.ratingKey === currentItem?.ratingKey,
      );
      const markers = currentItemInQueue?.Marker ?? [];

      updatePlaybackState({
        playQueue: updatedPlayQueue,
        markers,
      });
    }
  }, [
    updatedPlayQueue,
    playQueueId,
    currentItem?.ratingKey,
    updatePlaybackState,
  ]);

  // Use the most recent play queue data (either from state or polling)
  const activePlayQueue = updatedPlayQueue ?? playQueue;

  // Find next episode from play queue
  const nextEpisode = useMemo((): NextEpisodeInfo | null => {
    // Only work with episodes and when we have a play queue
    if (
      currentItem?.type !== "episode" ||
      !activePlayQueue?.MediaContainer?.Metadata
    ) {
      return null;
    }

    const episodes = activePlayQueue.MediaContainer.Metadata;
    const currentIndex = episodes.findIndex(
      (episode: PlayQueueItem) => episode.ratingKey === currentItem.ratingKey,
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
      index: nextEpisodeData.index ?? 0,
      parentIndex: nextEpisodeData.parentIndex ?? 0,
      thumb: nextEpisodeData.thumb,
      art: nextEpisodeData.art,
      duration: nextEpisodeData.duration ?? 0,
      grandparentTitle: nextEpisodeData.grandparentTitle ?? "",
      parentTitle: nextEpisodeData.parentTitle ?? "",
    };
  }, [currentItem, activePlayQueue]);

  // Auto-play logic - event-driven by video time
  useEffect(() => {
    if (!enabled || !autoPlay.isEnabled) {
      return;
    }

    // Don't trigger if no next episode found
    if (!nextEpisode) {
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

    // Check if we're near the end (last 5 seconds) and actively playing
    const isNearEndAndPlaying =
      isPlaying && timeRemaining <= 5 && timeRemaining > 0.5;

    if (isAtVeryEnd) {
      // At the very end - immediately play next episode (no countdown for skip/seek to end)
      triggerAutoPlay(nextEpisode);
    } else if (isNearEndAndPlaying) {
      // Start countdown when we're in the last 5 seconds while playing
      if (!autoPlay.isCountingDown) {
        startAutoPlayCountdown(nextEpisode);
      }
      // Update countdown seconds based on actual time remaining
      updateCountdownSeconds(timeRemaining);
    }
  }, [
    isPlaying,
    currentTime,
    duration,
    nextEpisode,
    enabled,
    autoPlay.isEnabled,
    autoPlay.isCountingDown,
    startAutoPlayCountdown,
    triggerAutoPlay,
    updateCountdownSeconds,
  ]);

  return {
    autoPlayState: autoPlay,
    hasNextEpisode: Boolean(nextEpisode),
    nextEpisode: nextEpisode,
    // Expose queue polling status for debugging
    isPollingQueue: Boolean(
      currentItem?.serverId && playQueueId && currentItem?.type === "episode",
    ),
  };
}
