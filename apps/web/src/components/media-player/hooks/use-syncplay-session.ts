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
  const session = useWatchTogetherStore((state) => state.session);
  const updateParticipant = useWatchTogetherStore(
    (state) => state.updateParticipant,
  );
  const currentItem = useMediaPlayerStore((state) => state.currentItem);
  const currentTime = useMediaPlayerStore((state) => state.currentTime);
  const isPlaying = useMediaPlayerStore((state) => state.isPlaying);
  const canPlay = useMediaPlayerStore((state) => state.canPlay);
  const clientRef = useRef<SyncplayClient | null>(null);
  const suppressNextLocalEventRef = useRef(false);

  const activeForCurrentItem = Boolean(
    session &&
      currentItem &&
      parseWatchTogetherSourceUri(session.room.sourceUri)?.serverId ===
        currentItem.serverId &&
      parseWatchTogetherSourceUri(session.room.sourceUri)?.ratingKey ===
        currentItem.ratingKey,
  );

  useEffect(() => {
    if (!session || !activeForCurrentItem) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      return;
    }

    const client = new SyncplayClient({
      room: session.room,
      user: session.localUser,
      onParticipant: updateParticipant,
      onPlaybackState: (state) => {
        const diffSeconds = currentTime - state.positionSeconds;
        const shouldSeek =
          state.shouldSeek ||
          diffSeconds >= SEEK_AHEAD_THRESHOLD_SECONDS ||
          diffSeconds <= SEEK_BEHIND_THRESHOLD_SECONDS;

        suppressNextLocalEventRef.current = true;

        if (shouldSeek) {
          seek(state.positionSeconds);
        }

        if (state.isPaused) {
          pause();
        } else {
          play();
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
  }, [
    activeForCurrentItem,
    currentTime,
    pause,
    play,
    seek,
    session,
    updateParticipant,
  ]);

  useEffect(() => {
    if (!clientRef.current || !activeForCurrentItem) {
      return;
    }

    clientRef.current.setReady(canPlay);
  }, [activeForCurrentItem, canPlay]);

  const sendLocalState = useCallback(
    (shouldSeek = false, timeOverride?: number) => {
      if (!activeForCurrentItem || !clientRef.current) {
        return;
      }

      if (suppressNextLocalEventRef.current) {
        suppressNextLocalEventRef.current = false;
        return;
      }

      clientRef.current.sendState({
        isPaused: !isPlaying,
        positionSeconds: timeOverride ?? currentTime,
        shouldSeek,
      });
    },
    [activeForCurrentItem, currentTime, isPlaying],
  );

  const onLocalPlay = useCallback(() => {
    sendLocalState(false);
  }, [sendLocalState]);

  const onLocalPause = useCallback(() => {
    sendLocalState(false);
  }, [sendLocalState]);

  const onLocalSeeked = useCallback(
    (time: number) => {
      sendLocalState(true, time);
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
