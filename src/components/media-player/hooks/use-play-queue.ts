"use client";

import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import { updatePlaybackStateAtom } from "~/atoms/media-player";
import type { MediaPlayerItem } from "~/types/media-player";
import { api } from "~/trpc/react";

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
  const [, updateState] = useAtom(updatePlaybackStateAtom);
  const lastItemRef = useRef<string | null>(null);

  // Create play queue mutation
  const createPlayQueueMutation = api.plex.createPlayQueue.useMutation({
    onSuccess: (playQueue) => {
      console.log("🎬 Play queue created:", playQueue);
      
      // Extract markers from the first metadata item
      const markers = playQueue.MediaContainer.Metadata?.[0]?.Marker ?? [];
      
      // Update media player state with play queue data
      updateState({
        playQueue,
        playQueueId: playQueue.MediaContainer.playQueueID.toString(),
        markers,
      });
    },
    onError: (error: unknown) => {
      console.error("Failed to create play queue:", error);
      // Continue playback without markers on error
      updateState({
        playQueue: null,
        playQueueId: null,
        markers: [],
      });
    },
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
      
      // Create play queue for marker support using .mutate (not .mutateAsync to avoid promise issues)
      createPlayQueueMutation.mutate({
        serverId: item.serverId,
        type: "video",
        uri,
        continuous: true,
        includeMarkers: true,
        includeChapters: true,
        shuffle: false,
        repeat: 0,
      });
    } else {
      // Clear play queue state if no valid item
      updateState({
        playQueue: null,
        playQueueId: null,
        markers: [],
      });
    }
  }, [item, createPlayQueueMutation, updateState]);

  return {
    isCreating: createPlayQueueMutation.isPending,
    error: createPlayQueueMutation.error,
  };
}