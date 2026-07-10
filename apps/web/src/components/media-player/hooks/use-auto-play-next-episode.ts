"use client";

import { useEffect, useMemo } from "react";
import type { PlayQueueItem } from "@multiplex/plex-query";
import { useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Option from "effect/Option";

import { playerCommands, usePlayerState } from "~/lib/effect/player-atoms";
import { playQueueAtom } from "~/lib/effect/plex-atoms";
import type { NextEpisodeInfo } from "~/types/media-player";

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
  const player = usePlayerState();
  const currentItem = player.currentItem;
  const currentTime = player.currentTime;
  const duration = player.duration;
  const isPlaying = player.isPlaying;
  const playQueue = player.playQueue;
  const playQueueId = player.playQueueId;
  const autoPlay = player.autoPlay;

  const shouldPoll = Boolean(
    currentItem?.serverId && playQueueId && currentItem?.type === "episode",
  );

  // Poll for play queue updates when we have a play queue ID
  const playQueueResult = useAtomValue(
    playQueueAtom({
      serverId: currentItem?.serverId ?? "",
      playQueueId: playQueueId ?? "",
      enabled: shouldPoll,
    }),
  );
  const updatedPlayQueue = Option.getOrUndefined(
    AsyncResult.value(playQueueResult),
  );

  // Update the play queue in state when we get fresh data
  useEffect(() => {
    if (updatedPlayQueue && playQueueId) {
      // Extract markers from the current item in the updated queue
      const currentItemInQueue = updatedPlayQueue.MediaContainer.Metadata?.find(
        (item: PlayQueueItem) => item.ratingKey === currentItem?.ratingKey,
      );
      const markers = currentItemInQueue?.Marker ?? [];

      playerCommands.updatePlaybackState({
        playQueue: updatedPlayQueue,
        markers,
      });
    }
  }, [updatedPlayQueue, playQueueId, currentItem?.ratingKey]);

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
    if (!enabled) {
      if (autoPlay.isCountingDown || autoPlay.nextEpisode) {
        playerCommands.cancelAutoPlay();
      }
      return;
    }

    if (!autoPlay.isEnabled) {
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
      playerCommands.triggerAutoPlay(nextEpisode);
    } else if (isNearEndAndPlaying) {
      // Start countdown when we're in the last 5 seconds while playing
      if (!autoPlay.isCountingDown) {
        playerCommands.startAutoPlayCountdown(nextEpisode);
      }
      // Update countdown seconds based on actual time remaining
      playerCommands.updateCountdownSeconds(timeRemaining);
    }
  }, [
    isPlaying,
    currentTime,
    duration,
    nextEpisode,
    enabled,
    autoPlay.isEnabled,
    autoPlay.isCountingDown,
    autoPlay.nextEpisode,
  ]);

  return {
    autoPlayState: autoPlay,
    hasNextEpisode: Boolean(nextEpisode),
    nextEpisode: nextEpisode,
    // Expose queue polling status for debugging
    isPollingQueue: shouldPoll,
  };
}
