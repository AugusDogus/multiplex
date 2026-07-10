"use client";

import { useEffect, useRef } from "react";
import { useAtomSet } from "@effect/atom-react";
import * as Exit from "effect/Exit";

import { playerCommands } from "~/lib/effect/player-atoms";
import { asPlayQueue } from "~/lib/effect/plex-boundary";
import { createPlayQueue } from "~/lib/effect/plex-atoms";
import type { MediaPlayerItem } from "~/types/media-player";

/* ────────────────────────────────────────────────────────────
   Play Queue Hook
   Handles creating and managing Plex play queues with markers
   ──────────────────────────────────────────────────────────── */

/**
 * Hook for managing play queue creation and marker data
 * @param item - Current media item
 * @returns Play queue management functions and data
 */
export function usePlayQueue(item: MediaPlayerItem | null) {
  const lastItemRef = useRef<string | null>(null);
  const createPlayQueueMutation = useAtomSet(createPlayQueue, {
    mode: "promiseExit",
  });

  /**
   * Create play queue when item changes
   */
  useEffect(() => {
    // Create a unique key for the current item to avoid duplicate requests
    const currentItemKey = item
      ? `${item.serverId}-${item.librarySectionID}-${item.ratingKey}`
      : null;

    // Only proceed if the item has actually changed
    if (currentItemKey === lastItemRef.current) {
      return;
    }

    lastItemRef.current = currentItemKey;

    if (item && item.serverId && item.librarySectionID && item.ratingKey) {
      // Use the full server URI format for play queues
      const uri = `server://${item.serverId}/com.plexapp.plugins.library${item.key}`;

      console.log("🎬 Creating play queue for:", item.title, "with URI:", uri);

      void (async () => {
        const exit = await createPlayQueueMutation({
          payload: {
            serverId: item.serverId,
            type: "video",
            uri,
            continuous: true,
            includeMarkers: true,
            includeChapters: true,
            shuffle: false,
            repeat: 0,
          },
        });
        if (Exit.isFailure(exit)) {
          console.error("Failed to create play queue:", exit.cause);
          // Continue playback without markers on error
          playerCommands.updatePlaybackState({
            playQueue: null,
            playQueueId: null,
            markers: [],
          });
          return;
        }

        const playQueue = asPlayQueue(exit.value);
        console.log("🎬 Play queue created:", playQueue);

        // Extract markers from the first metadata item
        const markers = playQueue.MediaContainer.Metadata?.[0]?.Marker ?? [];

        // Update media player state with play queue data
        playerCommands.updatePlaybackState({
          playQueue,
          playQueueId: playQueue.MediaContainer.playQueueID.toString(),
          markers,
        });
      })();
    } else {
      // Clear play queue state if no valid item
      playerCommands.updatePlaybackState({
        playQueue: null,
        playQueueId: null,
        markers: [],
      });
    }
  }, [item, createPlayQueueMutation]);

  return {
    isCreating: false,
    error: null,
  };
}
