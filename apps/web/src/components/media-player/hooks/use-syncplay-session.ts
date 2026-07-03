"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  parseLibraryItemUri,
  SyncplaySessionController,
  type SyncplayPlayerAdapter,
} from "@multiplex/plex-query";

import {
  createWatchTogetherSessionToasts,
  type WatchTogetherSessionToasts,
} from "~/components/watch-together/watch-together-session-toasts";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { useWatchTogetherStore } from "~/stores/watch-together-store";
import type { MediaPlayerActions } from "~/types/media-player";

interface UseSyncplaySessionOptions {
  actions: MediaPlayerActions;
}

export function useSyncplaySession({ actions }: UseSyncplaySessionOptions) {
  const { pause, play, seek } = actions;
  const controllerRef = useRef<SyncplaySessionController | null>(null);
  const toastsRef = useRef<WatchTogetherSessionToasts | null>(null);
  const session = useWatchTogetherStore((state) => state.session);
  const clearWatchTogetherSession = useWatchTogetherStore(
    (state) => state.clearSession,
  );
  const updateParticipant = useWatchTogetherStore(
    (state) => state.updateParticipant,
  );
  const currentItemServerId = useMediaPlayerStore(
    (state) => state.currentItem?.serverId,
  );
  const currentItemRatingKey = useMediaPlayerStore(
    (state) => state.currentItem?.ratingKey,
  );
  const canPlay = useMediaPlayerStore((state) => state.canPlay);
  const roomSource = session
    ? parseLibraryItemUri(session.room.sourceUri)
    : null;
  const activeForCurrentItem = Boolean(
    session &&
      currentItemServerId &&
      currentItemRatingKey &&
      roomSource?.serverId === currentItemServerId &&
      roomSource.ratingKey === currentItemRatingKey,
  );

  const player = useMemo<SyncplayPlayerAdapter>(
    () => ({
      getState: () => {
        const playerState = useMediaPlayerStore.getState();
        return {
          isPlaying: playerState.isPlaying,
          currentTime: playerState.currentTime,
          duration: playerState.duration,
          canPlay: playerState.canPlay,
          isLoading: playerState.isLoading,
          error: playerState.error,
        };
      },
      play,
      pause,
      seek,
    }),
    [pause, play, seek],
  );

  useEffect(() => {
    if (!session || !activeForCurrentItem) {
      controllerRef.current?.disconnect();
      controllerRef.current = null;
      if (session && currentItemServerId && currentItemRatingKey) {
        clearWatchTogetherSession();
      }
      return;
    }

    const toasts = createWatchTogetherSessionToasts({
      room: session.room,
      localUser: session.localUser,
    });
    const controller = new SyncplaySessionController({
      room: session.room,
      user: session.localUser,
      player,
      onParticipant: (participant) => {
        updateParticipant(participant);
        toasts.handleParticipant(participant);
      },
      onRemoteAction: toasts.handleRemoteAction,
      onFatalError: clearWatchTogetherSession,
    });

    controller.connect();
    controllerRef.current = controller;
    toastsRef.current = toasts;

    return () => {
      controller.disconnect();
      toasts.dispose();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      if (toastsRef.current === toasts) {
        toastsRef.current = null;
      }
    };
  }, [
    activeForCurrentItem,
    clearWatchTogetherSession,
    currentItemRatingKey,
    currentItemServerId,
    player,
    session,
    updateParticipant,
  ]);

  useEffect(() => {
    if (!activeForCurrentItem) {
      return;
    }

    controllerRef.current?.setReady(canPlay);
    if (canPlay) {
      toastsRef.current?.noteLocalStarted();
    }
  }, [activeForCurrentItem, canPlay]);

  const onLocalPlaybackChange = useCallback(
    (isPaused: boolean) => {
      if (!activeForCurrentItem) {
        return;
      }

      controllerRef.current?.handleLocalPlaybackChange(isPaused);
    },
    [activeForCurrentItem],
  );

  const onLocalSeeked = useCallback(
    (time: number) => {
      if (!activeForCurrentItem) {
        return;
      }

      controllerRef.current?.handleLocalSeeked(time);
    },
    [activeForCurrentItem],
  );

  // Broadcast a claimed pause so the rest of the room stops too (like the
  // official Plex client) — call right before tearing the session down, while
  // the socket is still open.
  const onLeaveSession = useCallback(() => {
    if (!activeForCurrentItem) {
      return;
    }

    controllerRef.current?.pauseRoom();
  }, [activeForCurrentItem]);

  return {
    isActive: activeForCurrentItem,
    onLocalPlaybackChange,
    onLocalSeeked,
    onLeaveSession,
  };
}
