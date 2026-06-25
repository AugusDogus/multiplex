"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  SyncplayClient,
  type SyncplayPlaybackState,
} from "@multiplex/plex-query";

import { parseWatchTogetherSourceUri } from "~/lib/watch-together-source";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { useWatchTogetherStore } from "~/stores/watch-together-store";
import type {
  MediaPlayerActions,
  MediaPlayerSeekResult,
} from "~/types/media-player";

const SEEK_AHEAD_THRESHOLD_SECONDS = 4;
const SEEK_BEHIND_THRESHOLD_SECONDS = -1.75;
const REMOTE_STATE_SETTLE_INTERVAL_MS = 25;
const REMOTE_SEEK_SUPPRESSION_MS = 5000;
const REMOTE_PLAYBACK_SUPPRESSION_MS = 750;

interface SuppressedPlaybackEvent {
  id: number;
  isPaused: boolean;
  expiresAt: number;
}

interface RemoteApplyResult {
  status: "applied" | "pending";
  shouldSeek: boolean;
  targetPosition: number;
  seekMode?: MediaPlayerSeekResult;
  seekSettled?: Promise<void>;
}

const SKIP_SYNCPLAY_REPLY = { skipReply: true } as const;

interface SuppressedSeekEvent {
  positionSeconds: number;
  expiresAt: number;
  mode: MediaPlayerSeekResult;
  settled: Promise<void>;
  resolve: () => void;
}

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
  const clientRef = useRef<SyncplayClient | null>(null);
  const canPlayRef = useRef(canPlay);
  const suppressedPlaybackEventIdRef = useRef(0);
  const suppressedPlaybackEventsRef = useRef<SuppressedPlaybackEvent[]>([]);
  const suppressedSeekRef = useRef<SuppressedSeekEvent | null>(null);
  const remoteStateGenerationRef = useRef(0);

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

  const addSuppressedPlaybackEvent = useCallback((isPaused: boolean) => {
    suppressedPlaybackEventIdRef.current += 1;
    const id = suppressedPlaybackEventIdRef.current;
    suppressedPlaybackEventsRef.current.push({
      id,
      isPaused,
      expiresAt: performance.now() + REMOTE_PLAYBACK_SUPPRESSION_MS,
    });
    return id;
  }, []);

  const removeSuppressedPlaybackEvent = useCallback((id: number) => {
    suppressedPlaybackEventsRef.current =
      suppressedPlaybackEventsRef.current.filter((event) => event.id !== id);
  }, []);

  const createSuppressedSeekEvent = useCallback(
    (positionSeconds: number, mode: MediaPlayerSeekResult) => {
      let resolveSettled: () => void = () => undefined;
      const settled = new Promise<void>((resolve) => {
        resolveSettled = resolve;
      });
      const event: SuppressedSeekEvent = {
        positionSeconds,
        expiresAt: performance.now() + REMOTE_SEEK_SUPPRESSION_MS,
        mode,
        settled,
        resolve: resolveSettled,
      };
      suppressedSeekRef.current = event;
      return event;
    },
    [],
  );

  const applyRemotePlaybackState = useCallback(
    (state: SyncplayPlaybackState): RemoteApplyResult => {
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
        return { status: "pending", shouldSeek, targetPosition };
      }

      let seekMode: MediaPlayerSeekResult | undefined;
      let seekSettled: Promise<void> | undefined;

      if (shouldSeek) {
        seekMode = actionsRef.current.seek(targetPosition);
        seekSettled =
          seekMode === "none"
            ? undefined
            : createSuppressedSeekEvent(targetPosition, seekMode).settled;
      }

      if (state.isPaused && playerState.isPlaying) {
        addSuppressedPlaybackEvent(true);
        actionsRef.current.pause();
      } else if (!state.isPaused && !playerState.isPlaying) {
        const suppressedEventId = addSuppressedPlaybackEvent(false);
        void Promise.resolve(actionsRef.current.play()).then((played) => {
          if (!played) {
            removeSuppressedPlaybackEvent(suppressedEventId);
          }
        });
      }
      return {
        status: "applied",
        shouldSeek,
        targetPosition,
        seekMode,
        seekSettled,
      };
    },
    [
      addSuppressedPlaybackEvent,
      createSuppressedSeekEvent,
      removeSuppressedPlaybackEvent,
    ],
  );

  const waitForRemoteStateToSettle = useCallback(
    async (
      state: SyncplayPlaybackState,
      applyResult: RemoteApplyResult,
      generation: number,
    ) => {
      let directSeekSettled = applyResult.seekMode !== "direct";
      if (applyResult.seekMode === "direct" && applyResult.seekSettled) {
        void applyResult.seekSettled.then(() => {
          directSeekSettled = true;
        });
      }

      while (remoteStateGenerationRef.current === generation) {
        const playerState = useMediaPlayerStore.getState();
        if (playerState.error) {
          break;
        }

        const playbackSettled = playerState.isPlaying !== state.isPaused;
        const positionSettled =
          !applyResult.shouldSeek ||
          ((applyResult.seekMode !== "direct" || directSeekSettled) &&
            Math.abs(playerState.currentTime - applyResult.targetPosition) <
              0.75 &&
            (applyResult.seekMode !== "reload" ||
              (playerState.canPlay && !playerState.isLoading)));

        if (playbackSettled && positionSettled) {
          break;
        }

        await new Promise((resolve) =>
          window.setTimeout(resolve, REMOTE_STATE_SETTLE_INTERVAL_MS),
        );
      }

      return SKIP_SYNCPLAY_REPLY;
    },
    [],
  );

  const waitForDurationThenApplyRemoteState = useCallback(
    async (state: SyncplayPlaybackState, generation: number) => {
      while (remoteStateGenerationRef.current === generation) {
        if (useMediaPlayerStore.getState().duration > 0) {
          const applyResult = applyRemotePlaybackState(state);
          return waitForRemoteStateToSettle(state, applyResult, generation);
        }

        await new Promise((resolve) =>
          window.setTimeout(resolve, REMOTE_STATE_SETTLE_INTERVAL_MS),
        );
      }

      return SKIP_SYNCPLAY_REPLY;
    },
    [applyRemotePlaybackState, waitForRemoteStateToSettle],
  );

  useEffect(() => {
    if (!session || !activeForCurrentItem) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      remoteStateGenerationRef.current += 1;
      suppressedPlaybackEventsRef.current = [];
      suppressedSeekRef.current = null;
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
          const generation = ++remoteStateGenerationRef.current;
          const result = applyRemotePlaybackState(state);
          return result.status === "pending"
            ? waitForDurationThenApplyRemoteState(state, generation)
            : waitForRemoteStateToSettle(state, result, generation);
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
            client.disconnect();
            clientRef.current = null;
            clearWatchTogetherSession();
            suppressedPlaybackEventsRef.current = [];
            suppressedSeekRef.current = null;
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
      remoteStateGenerationRef.current += 1;
      suppressedPlaybackEventsRef.current = [];
      suppressedSeekRef.current = null;
      clientRef.current = null;
    };
  }, [
    activeForCurrentItem,
    applyRemotePlaybackState,
    clearWatchTogetherSession,
    session,
    updateParticipant,
    waitForDurationThenApplyRemoteState,
    waitForRemoteStateToSettle,
  ]);

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
        suppressedSeek.resolve();
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
