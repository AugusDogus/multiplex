"use client";

import { useRef } from "react";
import { usePlayerStateSelector } from "~/lib/effect/player-atoms";
import { shallow } from "zustand/shallow";
import { patchSyncedContinueWatchingProgress } from "~/lib/sync-engine";
import { api } from "~/trpc/api";

/* ────────────────────────────────────────────────────────────
   Timeline Updates Hook
   Manages sending timeline updates to Plex server during playback
   ──────────────────────────────────────────────────────────── */

// While playing, report progress at roughly this cadence (Plex's own clients
// poll ~every 10s). The `timeupdate` event fires several times a second, so
// without throttling we'd flood the server with a request per second per
// viewer — which piles up (each call re-resolves the server) and starts failing
// with "Failed to fetch", spamming the console. State changes (play/pause/seek/
// stop/item change) still report immediately.
const TIMELINE_PROGRESS_INTERVAL_MS = 10_000;

function getOrCreateSessionId(ref: { current: string | null }) {
  ref.current ??= `multiplex-${crypto.randomUUID()}`;
  return ref.current;
}

/**
 * Hook to manage timeline updates to Plex server during media playback
 * Uses video events directly instead of intervals
 */
export function useTimelineUpdates({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const { currentItem, currentTime, duration, isPlaying } =
    usePlayerStateSelector(
      (state) => ({
        currentItem: state.currentItem,
        currentTime: state.currentTime,
        duration: state.duration,
        isPlaying: state.isPlaying,
      }),
      shallow,
    );
  const sessionIdRef = useRef<string | null>(null);
  const lastUpdateRef = useRef<{
    currentTime: number;
    state: string;
    serverId: string;
    ratingKey: string;
  } | null>(null);
  const lastSentAtRef = useRef<number | null>(null);
  // Best-effort progress reporting; surface a transient failure once rather
  // than logging every retry (which would flood the dev error overlay).
  const hasLoggedFailureRef = useRef(false);

  const sendTimelineMutation = api.plex.sendTimeline.useMutation();

  // Get or create session ID
  const getSessionId = () => getOrCreateSessionId(sessionIdRef);

  // Send timeline update for any playback state
  const sendTimelineUpdate = async (
    playbackState: "playing" | "paused" | "stopped",
    timeOverride?: number,
  ) => {
    if (!enabled || !currentItem) return;

    const sessionId = getSessionId();
    const timeToUse = timeOverride ?? currentTime;

    // Check if we should send an update
    const lastUpdate = lastUpdateRef.current;
    const hasStateChanged = lastUpdate?.state !== playbackState;
    const hasTimeChanged =
      !lastUpdate || Math.abs(lastUpdate.currentTime - timeToUse) >= 1;
    const hasItemChanged =
      lastUpdate?.serverId !== currentItem.serverId ||
      lastUpdate?.ratingKey !== currentItem.ratingKey;

    if (!hasStateChanged && !hasTimeChanged && !hasItemChanged) return;

    // Throttle the high-frequency "playing" progress pings; always let state/
    // item changes (play/pause/seek/stop/new item) through immediately.
    const isPeriodicProgress =
      !hasStateChanged && !hasItemChanged && playbackState === "playing";
    const now = Date.now();
    if (
      isPeriodicProgress &&
      lastSentAtRef.current !== null &&
      now - lastSentAtRef.current < TIMELINE_PROGRESS_INTERVAL_MS
    ) {
      return;
    }

    // Apply Plex safety checks (except for stopped state)
    if (playbackState !== "stopped") {
      const durationMs = duration * 1000;
      const currentTimeMs = timeToUse * 1000;
      if (durationMs <= 30000 || durationMs - currentTimeMs <= 30000) return;
    }

    // Mark the attempt now (before awaiting) so a slow/failing request still
    // throttles the next one instead of letting them stack up.
    lastSentAtRef.current = now;

    try {
      await sendTimelineMutation.mutateAsync({
        serverId: currentItem.serverId,
        ratingKey: currentItem.ratingKey,
        key: `/library/metadata/${currentItem.ratingKey}`,
        playbackTime: Math.floor(timeToUse * 1000),
        time: Math.floor(timeToUse * 1000),
        duration: Math.floor(duration * 1000),
        state: playbackState,
        hasMDE: 1,
        context: "home:hub.continueWatching&row=0&col=0",
        sessionId,
      });

      // Update refs
      lastUpdateRef.current = {
        currentTime: timeToUse,
        state: playbackState,
        serverId: currentItem.serverId,
        ratingKey: currentItem.ratingKey,
      };

      // Plex accepted the timeline update — patch the sync-engine replica.
      // PlayerService remains the sole owner of the active player's current time.
      patchSyncedContinueWatchingProgress(
        {
          serverId: currentItem.serverId,
          ratingKey: currentItem.ratingKey,
        },
        timeToUse,
        duration,
      );
      hasLoggedFailureRef.current = false;
    } catch (error) {
      if (!hasLoggedFailureRef.current) {
        hasLoggedFailureRef.current = true;
        console.error("Timeline update failed:", error);
      }
    }
  };

  // Event handlers for video events
  const onPlay = () => {
    void sendTimelineUpdate("playing");
  };

  const onPause = () => {
    void sendTimelineUpdate("paused");
  };

  const onTimeUpdate = (currentTime: number) => {
    // Send playing update with current time
    void sendTimelineUpdate("playing", currentTime);
  };

  const onSeeked = (time: number) => {
    // Send update at new position with current playback state
    const currentState = isPlaying ? "playing" : "paused";
    void sendTimelineUpdate(currentState, time);
  };

  const onEnded = () => {
    // Video actually ended - send stopped with full duration
    void sendTimelineUpdate("stopped", duration);
  };

  const onStop = () => {
    // User manually stopped/closed - send stopped with current time
    void sendTimelineUpdate("stopped", currentTime);
  };

  // Clear session
  const clearSession = () => {
    sessionIdRef.current = null;
    lastUpdateRef.current = null;
    lastSentAtRef.current = null;
    hasLoggedFailureRef.current = false;
  };

  return {
    onPlay,
    onPause,
    onTimeUpdate,
    onSeeked,
    onEnded,
    onStop,
    clearSession,
  };
}
