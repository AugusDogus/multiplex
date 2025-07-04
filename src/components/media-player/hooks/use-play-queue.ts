"use client";

import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";
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
    onError: (error: any) => {
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
   * Create a play queue for the given media item
   */
  const createPlayQueue = useCallback(
    async (mediaItem: MediaPlayerItem) => {
      if (!mediaItem) return;

             try {
         // Generate the library URI for the media item using section ID
         const uri = `library://${mediaItem.librarySectionID}/item/${mediaItem.ratingKey}`;
         
         console.log("🎬 Creating play queue for:", mediaItem.title);
        
        await createPlayQueueMutation.mutateAsync({
          serverId: mediaItem.serverId,
          type: "video",
          uri,
          continuous: true,
          includeMarkers: true,
          includeChapters: true,
          shuffle: false,
          repeat: 0,
        });
      } catch (error) {
        console.error("Failed to create play queue:", error);
        // Don't block playback - just continue without markers
      }
    },
    [createPlayQueueMutation],
  );

  /**
   * Create play queue when item changes
   */
     useEffect(() => {
     if (item && item.serverId && item.librarySectionID && item.ratingKey) {
       // Create play queue for marker support
       createPlayQueue(item);
     } else {
       // Clear play queue state if no valid item
       updateState({
         playQueue: null,
         playQueueId: null,
         markers: [],
       });
     }
   }, [item, createPlayQueue, updateState]);

  return {
    createPlayQueue,
    isCreating: createPlayQueueMutation.isPending,
    error: createPlayQueueMutation.error,
  };
}