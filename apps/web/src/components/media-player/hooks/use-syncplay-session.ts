"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  parseLibraryItemUri,
  SyncplaySessionController,
  type SyncplayPlayerAdapter,
} from "@multiplex/plex-query";

import { useMediaPlayerStore } from "~/stores/media-player-store";
import { useWatchTogetherStore } from "~/stores/watch-together-store";
import type { MediaPlayerActions } from "~/types/media-player";

interface UseSyncplaySessionOptions {
  actions: MediaPlayerActions;
}

export function useSyncplaySession({ actions }: UseSyncplaySessionOptions) {
  const { pause, play, seek } = actions;
  const controllerRef = useRef<SyncplaySessionController | null>(null);
  const session = useWatchTogetherStore((state) => state.session);
  const clearWatchTogetherSession = useWatchTogetherStore(
    (state) => state.clearSession,
  );
  const updateParticipant = useWatchTogetherStore(
    (state) => state.updateParticipant,
  );
  const currentItem = useMediaPlayerStore((state) => state.currentItem);
  const canPlay = useMediaPlayerStore((state) => state.canPlay);
  const roomSource = session
    ? parseLibraryItemUri(session.room.sourceUri)
    : null;
  const activeForCurrentItem = Boolean(
    session &&
      currentItem &&
      roomSource?.serverId === currentItem.serverId &&
      roomSource.ratingKey === currentItem.ratingKey,
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
      if (session && currentItem) {
        clearWatchTogetherSession();
      }
      return;
    }

    const controller = new SyncplaySessionController({
      room: session.room,
      user: session.localUser,
      player,
      onParticipant: updateParticipant,
      onFatalError: clearWatchTogetherSession,
    });

    controller.connect();
    controllerRef.current = controller;

    return () => {
      controller.disconnect();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [
    activeForCurrentItem,
    clearWatchTogetherSession,
    currentItem,
    player,
    session,
    updateParticipant,
  ]);

  useEffect(() => {
    if (!activeForCurrentItem) {
      return;
    }

    controllerRef.current?.setReady(canPlay);
  }, [activeForCurrentItem, canPlay]);

  const onLocalPlaybackChange = useCallback((isPaused: boolean) => {
    controllerRef.current?.handleLocalPlaybackChange(isPaused);
  }, []);

  const onLocalSeeked = useCallback((time: number) => {
    controllerRef.current?.handleLocalSeeked(time);
  }, []);

  return {
    isActive: activeForCurrentItem,
    onLocalPlaybackChange,
    onLocalSeeked,
  };
}
