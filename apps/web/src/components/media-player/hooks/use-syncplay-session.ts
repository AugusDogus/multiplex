"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  SyncplayClient,
  type SyncplayPlaybackState,
} from "@multiplex/plex-query";

import { parseWatchTogetherSourceUri } from "~/lib/watch-together-source";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { useWatchTogetherStore } from "~/stores/watch-together-store";
import type { MediaPlayerActions } from "~/types/media-player";

const SEEK_AHEAD_THRESHOLD_SECONDS = 4;
const SEEK_BEHIND_THRESHOLD_SECONDS = -1.75;
const REMOTE_STATE_SETTLE_TIMEOUT_MS = 1000;
const REMOTE_STATE_SETTLE_INTERVAL_MS = 25;
const REMOTE_SEEK_SUPPRESSION_MS = 5000;
const REMOTE_PLAYBACK_SUPPRESSION_MS = 750;

function clampRemotePosition(
  positionSeconds: number,
  duration: number,
): number {
  if (duration <= 0) {
    return positionSeconds;
  }

  return Math.min(Math.max(positionSeconds, 0), duration);
}

interface UseSyncplaySessionOptions {
  actions: MediaPlayerActions;
}

export function useSyncplaySession({ actions }: UseSyncplaySessionOptions) {
  const { pause, play, seek } = actions;
  const actionsRef = useRef({ pause, play, seek });
  const session = useWatchTogetherStore((state) => state.session);
  const clearWatchTogetherSession = useWatchTogetherStore(
    (state) => state.clearSession,
  );
  const updateParticipant = useWatchTogetherStore(
    (state) => state.updateParticipant,
  );
  const currentItem = useMediaPlayerStore((state) => state.currentItem);
  const canPlay = useMediaPlayerStore((state) => state.canPlay);
  const duration = useMediaPlayerStore((state) => state.duration);
  const clientRef = useRef<SyncplayClient | null>(null);
  const canPlayRef = useRef(canPlay);
  const suppressedPlaybackEventsRef = useRef<
    Array<{ isPaused: boolean; expiresAt: number }>
  >([]);
  const suppressedSeekRef = useRef<{
    positionSeconds: number;
    expiresAt: number;
  } | null>(null);
  const pendingRemoteStateRef = useRef<SyncplayPlaybackState | null>(null);

  const activeForCurrentItem = Boolean(
    session &&
      currentItem &&
      parseWatchTogetherSourceUri(session.room.sourceUri)?.serverId ===
        currentItem.serverId &&
      parseWatchTogetherSourceUri(session.room.sourceUri)?.ratingKey ===
        currentItem.ratingKey,
  );

  useEffect(() => {
    actionsRef.current = { pause, play, seek };
  }, [pause, play, seek]);

  useEffect(() => {
    canPlayRef.current = canPlay;
  }, [canPlay]);

  const applyRemotePlaybackState = useCallback(
    (state: SyncplayPlaybackState): "applied" | "pending" => {
      const playerState = useMediaPlayerStore.getState();
      const targetPosition = clampRemotePosition(
        state.positionSeconds,
        playerState.duration,
      );
      const diffSeconds = playerState.currentTime - targetPosition;
      const shouldSeek =
        state.shouldSeek ||
        diffSeconds >= SEEK_AHEAD_THRESHOLD_SECONDS ||
        diffSeconds <= SEEK_BEHIND_THRESHOLD_SECONDS;

      if (shouldSeek && playerState.duration <= 0) {
        pendingRemoteStateRef.current = state;
        return "pending";
      }

      if (shouldSeek) {
        suppressedSeekRef.current = {
          positionSeconds: targetPosition,
          expiresAt: performance.now() + REMOTE_SEEK_SUPPRESSION_MS,
        };
        actionsRef.current.seek(targetPosition);
      }

      if (state.isPaused && playerState.isPlaying) {
        suppressedPlaybackEventsRef.current.push({
          isPaused: true,
          expiresAt: performance.now() + REMOTE_PLAYBACK_SUPPRESSION_MS,
        });
        actionsRef.current.pause();
      } else if (!state.isPaused && !playerState.isPlaying) {
        suppressedPlaybackEventsRef.current.push({
          isPaused: false,
          expiresAt: performance.now() + REMOTE_PLAYBACK_SUPPRESSION_MS,
        });
        actionsRef.current.play();
      }
      return "applied";
    },
    [],
  );

  const getCurrentPlaybackState = useCallback(() => {
    const playerState = useMediaPlayerStore.getState();
    return {
      isPaused: !playerState.isPlaying,
      positionSeconds: playerState.currentTime,
      shouldSeek: false,
    };
  }, []);

  const waitForRemoteStateToSettle = useCallback(
    async (state: SyncplayPlaybackState) => {
      const startedAt = performance.now();

      while (performance.now() - startedAt < REMOTE_STATE_SETTLE_TIMEOUT_MS) {
        const playerState = useMediaPlayerStore.getState();
        const targetPosition = clampRemotePosition(
          state.positionSeconds,
          playerState.duration,
        );
        const playbackSettled = playerState.isPlaying !== state.isPaused;
        const positionSettled =
          !state.shouldSeek ||
          Math.abs(playerState.currentTime - targetPosition) < 0.75;

        if (playbackSettled && positionSettled) {
          break;
        }

        await new Promise((resolve) =>
          window.setTimeout(resolve, REMOTE_STATE_SETTLE_INTERVAL_MS),
        );
      }

      return getCurrentPlaybackState();
    },
    [getCurrentPlaybackState],
  );

  useEffect(() => {
    if (!session || !activeForCurrentItem) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      suppressedPlaybackEventsRef.current = [];
      suppressedSeekRef.current = null;
      pendingRemoteStateRef.current = null;
      return;
    }

    let disposed = false;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let sawFatalError = false;

    const clearReconnectTimeout = () => {
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      const client = new SyncplayClient({
        room: session.room,
        user: session.localUser,
        onParticipant: updateParticipant,
        onPlaybackState: async (state) => {
          const result = applyRemotePlaybackState(state);
          return result === "pending"
            ? {
                isPaused: state.isPaused,
                positionSeconds: state.positionSeconds,
                shouldSeek: false,
              }
            : waitForRemoteStateToSettle(state);
        },
        onClose: () => {
          if (disposed || clientRef.current !== client) {
            return;
          }

          clientRef.current = null;
          if (sawFatalError) {
            return;
          }

          clearReconnectTimeout();
          reconnectTimeout = setTimeout(connect, 1000);
        },
        onError: (error) => {
          if (disposed || clientRef.current !== client) {
            return;
          }

          sawFatalError =
            error instanceof Error &&
            error.message.startsWith("Syncplay protocol error:");

          if (sawFatalError) {
            clientRef.current = null;
            clearWatchTogetherSession();
            suppressedPlaybackEventsRef.current = [];
            suppressedSeekRef.current = null;
            pendingRemoteStateRef.current = null;
          }
        },
      });

      client.connect();
      client.setReady(canPlayRef.current);
      clientRef.current = client;
    };

    connect();

    return () => {
      disposed = true;
      clearReconnectTimeout();
      clientRef.current?.disconnect();
      suppressedPlaybackEventsRef.current = [];
      suppressedSeekRef.current = null;
      pendingRemoteStateRef.current = null;
      clientRef.current = null;
    };
  }, [
    activeForCurrentItem,
    applyRemotePlaybackState,
    clearWatchTogetherSession,
    session,
    updateParticipant,
    waitForRemoteStateToSettle,
  ]);

  useEffect(() => {
    if (!activeForCurrentItem || !canPlay || duration <= 0) {
      return;
    }

    const pendingState = pendingRemoteStateRef.current;
    if (!pendingState) {
      return;
    }

    pendingRemoteStateRef.current = null;
    applyRemotePlaybackState(pendingState);
  }, [activeForCurrentItem, applyRemotePlaybackState, canPlay, duration]);

  useEffect(() => {
    if (!clientRef.current || !activeForCurrentItem) {
      return;
    }

    clientRef.current.setReady(canPlay);
  }, [activeForCurrentItem, canPlay]);

  const sendLocalState = useCallback(
    (nextState: { isPaused: boolean; shouldSeek?: boolean; time?: number }) => {
      if (!activeForCurrentItem || !clientRef.current) {
        return;
      }

      const now = performance.now();
      suppressedPlaybackEventsRef.current =
        suppressedPlaybackEventsRef.current.filter(
          (event) => event.expiresAt >= now,
        );
      const suppressedPlaybackIndex =
        suppressedPlaybackEventsRef.current.findIndex(
          (event) => event.isPaused === nextState.isPaused,
        );

      if (suppressedPlaybackIndex >= 0) {
        suppressedPlaybackEventsRef.current.splice(suppressedPlaybackIndex, 1);
        return;
      }

      const playerState = useMediaPlayerStore.getState();
      clientRef.current.sendState({
        isPaused: nextState.isPaused,
        positionSeconds: nextState.time ?? playerState.currentTime,
        shouldSeek: nextState.shouldSeek ?? false,
      });
    },
    [activeForCurrentItem],
  );

  const onLocalPlaybackChange = useCallback(
    (isPaused: boolean) => {
      sendLocalState({ isPaused });
    },
    [sendLocalState],
  );

  const onLocalSeeked = useCallback(
    (time: number) => {
      const suppressedSeek = suppressedSeekRef.current;
      if (
        suppressedSeek &&
        performance.now() <= suppressedSeek.expiresAt &&
        Math.abs(time - suppressedSeek.positionSeconds) < 0.75
      ) {
        suppressedSeekRef.current = null;
        return;
      }

      if (suppressedSeek && performance.now() > suppressedSeek.expiresAt) {
        suppressedSeekRef.current = null;
      }

      sendLocalState({
        isPaused: !useMediaPlayerStore.getState().isPlaying,
        shouldSeek: true,
        time,
      });
    },
    [sendLocalState],
  );

  return {
    isActive: activeForCurrentItem,
    onLocalPlaybackChange,
    onLocalSeeked,
  };
}
