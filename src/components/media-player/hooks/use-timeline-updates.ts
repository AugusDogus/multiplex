"use client";

import { useAtom, useAtomValue } from "jotai";
import { useCallback, useRef } from "react";
import {
  mediaPlayerStateAtom,
  updateItemProgressAtom,
} from "~/atoms/media-player";
import { api } from "~/trpc/react";

/* ────────────────────────────────────────────────────────────
   Timeline Updates Hook
   Manages sending timeline updates to Plex server during playback
   ──────────────────────────────────────────────────────────── */

/**
 * Hook to manage timeline updates to Plex server during media playback
 * Uses video events directly instead of intervals
 */
export function useTimelineUpdates() {
  const state = useAtomValue(mediaPlayerStateAtom);
  const [, updateItemProgress] = useAtom(updateItemProgressAtom);

  const sessionIdRef = useRef<string | null>(null);
  const lastUpdateRef = useRef<{
    currentTime: number;
    state: string;
    ratingKey?: string;
  } | null>(null);

  const sendTimelineMutation = api.plex.sendTimeline.useMutation();

  // Get or create session ID
  const getSessionId = useCallback(() => {
    sessionIdRef.current ??= `multiplex-${crypto.randomUUID()}`;
    return sessionIdRef.current;
  }, []);

  // Send timeline update for any playback state
  const sendTimelineUpdate = useCallback(
    async (
      playbackState: "playing" | "paused" | "stopped",
      currentTime?: number,
    ) => {
      if (!state.currentItem) return;

      const sessionId = getSessionId();
      const timeToUse = currentTime ?? state.currentTime;

      // Check if we should send an update
      const lastUpdate = lastUpdateRef.current;
      const hasStateChanged = !lastUpdate || lastUpdate.state !== playbackState;
      const hasTimeChanged =
        !lastUpdate || Math.abs(lastUpdate.currentTime - timeToUse) >= 1;
      const hasItemChanged =
        !lastUpdate || lastUpdate.ratingKey !== state.currentItem.ratingKey;

      if (!hasStateChanged && !hasTimeChanged && !hasItemChanged) return;

      // Apply Plex safety checks (except for stopped state)
      if (playbackState !== "stopped") {
        const durationMs = state.duration * 1000;
        const currentTimeMs = timeToUse * 1000;
        if (durationMs <= 30000 || durationMs - currentTimeMs <= 30000) return;
      }

      try {
        await sendTimelineMutation.mutateAsync({
          serverId: state.currentItem.serverId,
          ratingKey: state.currentItem.ratingKey,
          key: `/library/metadata/${state.currentItem.ratingKey}`,
          playbackTime: Math.floor(timeToUse * 1000),
          time: Math.floor(timeToUse * 1000),
          duration: Math.floor(state.duration * 1000),
          state: playbackState,
          hasMDE: 1,
          context: "home:hub.continueWatching&row=0&col=0",
          sessionId,
        });

        // Update refs
        lastUpdateRef.current = {
          currentTime: timeToUse,
          state: playbackState,
          ratingKey: state.currentItem.ratingKey,
        };

        // Update progress atom for real-time UI
        updateItemProgress({
          ratingKey: state.currentItem.ratingKey,
          progressPercent: (timeToUse / state.duration) * 100,
        });
      } catch (error) {
        console.error("Timeline update failed:", error);
      }
    },
    [state, getSessionId, sendTimelineMutation, updateItemProgress],
  );

  // Event handlers for video events
  const onPlay = useCallback(() => {
    void sendTimelineUpdate("playing");
  }, [sendTimelineUpdate]);

  const onPause = useCallback(() => {
    void sendTimelineUpdate("paused");
  }, [sendTimelineUpdate]);

  const onTimeUpdate = useCallback(
    (currentTime: number) => {
      // Send playing update with current time
      void sendTimelineUpdate("playing", currentTime);
    },
    [sendTimelineUpdate],
  );

  const onSeeked = useCallback(
    (currentTime: number) => {
      // Send update at new position with current playback state
      const currentState = state.isPlaying ? "playing" : "paused";
      void sendTimelineUpdate(currentState, currentTime);
    },
    [sendTimelineUpdate, state.isPlaying],
  );

  const onEnded = useCallback(() => {
    // Video actually ended - send stopped with full duration
    void sendTimelineUpdate("stopped", state.duration);
  }, [sendTimelineUpdate, state.duration]);

  const onStop = useCallback(() => {
    // User manually stopped/closed - send stopped with current time
    void sendTimelineUpdate("stopped", state.currentTime);
  }, [sendTimelineUpdate, state.currentTime]);

  // Clear session
  const clearSession = useCallback(() => {
    sessionIdRef.current = null;
    lastUpdateRef.current = null;
  }, []);

  return {
    onPlay,
    onPause,
    onTimeUpdate,
    onSeeked,
    onEnded,
    onStop,
    clearSession,
    sessionId: sessionIdRef.current,
  };
}
