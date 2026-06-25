"use client";

import { useCallback, useEffect, useRef } from "react";
import { SyncplayClient } from "@multiplex/plex-query";

import { parseWatchTogetherSourceUri } from "~/lib/watch-together-source";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { useWatchTogetherStore } from "~/stores/watch-together-store";
import type { MediaPlayerActions } from "~/types/media-player";

const SEEK_AHEAD_THRESHOLD_SECONDS = 4;
const SEEK_BEHIND_THRESHOLD_SECONDS = -1.75;

interface UseSyncplaySessionOptions {
  actions: MediaPlayerActions;
}

export function useSyncplaySession({ actions }: UseSyncplaySessionOptions) {
  const { pause, play, seek } = actions;
  const actionsRef = useRef({ pause, play, seek });
  const session = useWatchTogetherStore((state) => state.session);
  const updateParticipant = useWatchTogetherStore(
    (state) => state.updateParticipant,
  );
  const currentItem = useMediaPlayerStore((state) => state.currentItem);
  const canPlay = useMediaPlayerStore((state) => state.canPlay);
  const clientRef = useRef<SyncplayClient | null>(null);
  const suppressedLocalEventCountRef = useRef(0);

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
    if (!session || !activeForCurrentItem) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      return;
    }

    const client = new SyncplayClient({
      room: session.room,
      user: session.localUser,
      getPlaybackState: () => {
        const state = useMediaPlayerStore.getState();
        return {
          isPaused: !state.isPlaying,
          positionSeconds: state.currentTime,
          shouldSeek: false,
        };
      },
      onParticipant: updateParticipant,
      onPlaybackState: (state) => {
        const currentTime = useMediaPlayerStore.getState().currentTime;
        const currentlyPlaying = useMediaPlayerStore.getState().isPlaying;
        const diffSeconds = currentTime - state.positionSeconds;
        const shouldSeek =
          state.shouldSeek ||
          diffSeconds >= SEEK_AHEAD_THRESHOLD_SECONDS ||
          diffSeconds <= SEEK_BEHIND_THRESHOLD_SECONDS;

        const willChangePlayback = state.isPaused === currentlyPlaying;
        suppressedLocalEventCountRef.current +=
          (shouldSeek ? 1 : 0) + (willChangePlayback ? 1 : 0);

        if (shouldSeek) {
          actionsRef.current.seek(state.positionSeconds);
        }

        if (state.isPaused) {
          actionsRef.current.pause();
        } else {
          actionsRef.current.play();
        }
      },
    });

    client.connect();
    clientRef.current = client;

    return () => {
      client.disconnect();
      if (clientRef.current === client) {
        clientRef.current = null;
      }
    };
  }, [activeForCurrentItem, session, updateParticipant]);

  useEffect(() => {
    if (!clientRef.current || !activeForCurrentItem) {
      return;
    }

    clientRef.current.setReady(canPlay);
  }, [activeForCurrentItem, canPlay]);

  const sendLocalState = useCallback(
    (isPaused: boolean, shouldSeek = false, timeOverride?: number) => {
      if (!activeForCurrentItem || !clientRef.current) {
        return;
      }

      if (suppressedLocalEventCountRef.current > 0) {
        suppressedLocalEventCountRef.current -= 1;
        return;
      }

      const state = useMediaPlayerStore.getState();
      clientRef.current.sendState({
        isPaused,
        positionSeconds: timeOverride ?? state.currentTime,
        shouldSeek,
      });
    },
    [activeForCurrentItem],
  );

  const onLocalPlay = useCallback(() => {
    sendLocalState(false, false);
  }, [sendLocalState]);

  const onLocalPause = useCallback(() => {
    sendLocalState(true, false);
  }, [sendLocalState]);

  const onLocalSeeked = useCallback(
    (time: number) => {
      sendLocalState(!useMediaPlayerStore.getState().isPlaying, true, time);
    },
    [sendLocalState],
  );

  return {
    isActive: activeForCurrentItem,
    onLocalPlay,
    onLocalPause,
    onLocalSeeked,
  };
}
