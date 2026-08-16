"use client";

import { useEffect, useRef } from "react";
import { playerCommands } from "~/lib/effect/player-atoms";
import type { MediaPlayerItem } from "~/types/media-player";
import { api } from "~/trpc/api";

/* ────────────────────────────────────────────────────────────
   Play Queue Hook
   Handles creating and managing Plex play queues with markers
   ──────────────────────────────────────────────────────────── */

/**
 * Hook for managing play queue creation and marker data
 * @param item - Current media item
 * @returns Play queue management functions and data
 */
export function usePlayQueue(
  item: MediaPlayerItem | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const lastItemRef = useRef<string | null>(null);

  // Create play queue mutation
  const createPlayQueueMutation = api.plex.createPlayQueue.useMutation();

  /**
   * Create play queue when item changes
   */
  useEffect(() => {
    const playbackIdentity = playerCommands.playbackIdentity();

    if (!enabled) {
      const disabledItemKey = playbackIdentity
        ? `${playbackIdentity.streamSessionId}-guest-transient`
        : "guest-transient-no-playback";
      if (lastItemRef.current === disabledItemKey) {
        return;
      }
      lastItemRef.current = disabledItemKey;
      if (playbackIdentity) {
        playerCommands.updatePlaybackStateFor(playbackIdentity, {
          playQueue: null,
          playQueueId: null,
          markers: [],
        });
      }
      return;
    }

    if (item && item.serverId && item.librarySectionID && item.ratingKey) {
      if (
        playbackIdentity?.serverId !== item.serverId ||
        playbackIdentity?.ratingKey !== item.ratingKey
      ) {
        return;
      }

      // Include the stream session so replaying the same item creates a new queue.
      const currentItemKey = `${playbackIdentity.streamSessionId}-${item.serverId}-${item.librarySectionID}-${item.ratingKey}`;
      if (currentItemKey === lastItemRef.current) {
        return;
      }
      lastItemRef.current = currentItemKey;

      console.log("🎬 Creating play queue for:", item.title);

      // Create play queue for marker support using .mutate (not .mutateAsync to avoid promise issues)
      createPlayQueueMutation.mutate(
        {
          serverId: item.serverId,
          type: "video",
          ratingKey: item.ratingKey,
          continuous: true,
          includeMarkers: true,
          includeChapters: true,
          shuffle: false,
          repeat: 0,
        },
        {
          onSuccess: (playQueue) => {
            console.log("🎬 Play queue created:", playQueue);

            const markers =
              playQueue.MediaContainer.Metadata?.[0]?.Marker ?? [];
            playerCommands.updatePlaybackStateFor(playbackIdentity, {
              playQueue,
              playQueueId: playQueue.MediaContainer.playQueueID.toString(),
              markers,
            });
          },
          onError: (error) => {
            console.error("Failed to create play queue:", error);
            // Continue the initiating playback without markers on error.
            playerCommands.updatePlaybackStateFor(playbackIdentity, {
              playQueue: null,
              playQueueId: null,
              markers: [],
            });
          },
        },
      );
    } else {
      const invalidItemKey = playbackIdentity
        ? `${playbackIdentity.streamSessionId}-invalid-item`
        : null;
      if (invalidItemKey === lastItemRef.current) {
        return;
      }
      lastItemRef.current = invalidItemKey;

      // Clear play queue state if no valid item
      if (playbackIdentity) {
        playerCommands.updatePlaybackStateFor(playbackIdentity, {
          playQueue: null,
          playQueueId: null,
          markers: [],
        });
      }
    }
  }, [item, enabled, createPlayQueueMutation]);

  return {
    isCreating: createPlayQueueMutation.isPending,
    error: createPlayQueueMutation.error,
  };
}
