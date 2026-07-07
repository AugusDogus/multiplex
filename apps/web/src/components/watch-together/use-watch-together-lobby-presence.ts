"use client";

import { useEffect } from "react";
import {
  SyncplayClient,
  type SyncplayUser,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";

import { useWatchTogetherStore } from "~/stores/watch-together-store";

const PRESENCE_RECONNECT_DELAY_MS = 2000;

type PresenceRoom = Pick<
  WatchTogetherRoom,
  "id" | "syncplayHost" | "syncplayPort" | "sourceUri"
>;

interface UseWatchTogetherLobbyPresenceOptions {
  room: PresenceRoom | undefined;
  localUser: SyncplayUser | null;
  enabled: boolean;
  /**
   * Fires on every room `State` ping with the current playhead, so the lobby
   * can start a late joiner at the room's position instead of resetting to 0.
   */
  onRoomState?: (state: { paused: boolean; positionSeconds: number }) => void;
}

/**
 * Keeps a Syncplay connection open while the user sits in the lobby so everyone
 * can see who has actually joined (not just who was invited). It joins the room
 * and reports readiness as `false` (present, not yet watching). Because it has
 * no player and never sends a local play/pause/seek, the client only replies to
 * the server's State pings by echoing the room's current playstate — a
 * heartbeat that keeps the membership alive without dragging the position/pause
 * of anyone who is actually watching. This mirrors how Plex's own client
 * behaves when its player isn't in the foreground. It is disabled once playback
 * starts, since the media player owns the real (driving) connection then.
 */
export function useWatchTogetherLobbyPresence({
  room,
  localUser,
  enabled,
  onRoomState,
}: UseWatchTogetherLobbyPresenceOptions) {
  const updateParticipant = useWatchTogetherStore(
    (state) => state.updateParticipant,
  );

  // `onRoomState` must be stable (memoized by the caller); it's a dependency of
  // the connection effect, so an unstable callback would reconnect every render.
  useEffect(() => {
    if (!enabled || !room || !localUser) {
      return;
    }

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let client: SyncplayClient | null = null;

    const connect = () => {
      if (disposed) {
        return;
      }

      const nextClient = new SyncplayClient({
        room,
        user: localUser,
        observer: true,
        onParticipant: updateParticipant,
        onRoomState,
        onClose: () => {
          if (disposed || client !== nextClient) {
            return;
          }
          client = null;
          reconnectTimer = setTimeout(connect, PRESENCE_RECONNECT_DELAY_MS);
        },
      });

      nextClient.connect();
      // Present in the lobby but not ready to play; only changes once a real
      // player attaches (which happens via the media player, not here).
      nextClient.setReady(false);
      client = nextClient;
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      client?.disconnect();
      client = null;
    };
  }, [enabled, room, localUser, updateParticipant, onRoomState]);
}
