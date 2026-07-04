"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  parseLibraryItemUri,
  type SyncplayPlayerAdapter,
} from "@multiplex/plex-query";

import {
  bindWatchTogetherSession,
  type WatchTogetherSessionBinding,
} from "~/components/watch-together/watch-together-session-binding";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { useWatchTogetherStore } from "~/stores/watch-together-store";
import type { MediaPlayerActions } from "~/types/media-player";

interface UseSyncplaySessionOptions {
  actions: MediaPlayerActions;
}

/**
 * React lifecycle for a Watch Together playback session: while the active
 * session matches the item in the player, a {@link bindWatchTogetherSession}
 * binding exists; all actual session logic is event-driven inside the binding.
 */
export function useSyncplaySession({ actions }: UseSyncplaySessionOptions) {
  const { pause, play, seek } = actions;
  const bindingRef = useRef<WatchTogetherSessionBinding | null>(null);
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
      if (session && currentItemServerId && currentItemRatingKey) {
        clearWatchTogetherSession();
      }
      return;
    }

    const binding = bindWatchTogetherSession({
      room: session.room,
      localUser: session.localUser,
      player,
      onParticipant: updateParticipant,
      onFatalError: clearWatchTogetherSession,
    });
    bindingRef.current = binding;

    return () => {
      binding.dispose();
      if (bindingRef.current === binding) {
        bindingRef.current = null;
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

  const onLocalPlaybackChange = useCallback((isPaused: boolean) => {
    bindingRef.current?.handleLocalPlaybackChange(isPaused);
  }, []);

  const onLocalSeeked = useCallback((time: number) => {
    bindingRef.current?.handleLocalSeeked(time);
  }, []);

  return {
    isActive: activeForCurrentItem,
    onLocalPlaybackChange,
    onLocalSeeked,
  };
}
