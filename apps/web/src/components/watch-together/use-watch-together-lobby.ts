"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  MULTIPLEX_SYNCPLAY_DEVICE_NAME,
  allInvitedPresent,
  getLobbyHint,
  getParticipantStatus,
  isSoloRoom,
  isSomeoneElseWatching,
  participantsByUserId as mergeParticipantsByUserId,
  type ParticipantMap,
  type SyncplayParticipantState,
  type SyncplayUser,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";
import { toast } from "sonner";

import { useWatchTogetherRoomMedia } from "~/components/watch-together/use-watch-together-room-media";
import {
  isSessionForRoom,
  resolveLobbyLeaveTarget,
} from "~/components/watch-together/watch-together-lobby-leave";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { getPlexClientIdentifier } from "~/lib/device-identifier";
import { sessionCommands, useSessionState } from "~/lib/effect/session-atoms";
import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";
import { api } from "~/trpc/api";

export type LobbyViewModel =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | {
      readonly status: "ready";
      readonly room: WatchTogetherRoom;
      readonly localUserId: number;
      readonly media: ReturnType<typeof useWatchTogetherRoomMedia>;
      readonly participantsByUserId: Map<number, SyncplayParticipantState>;
      readonly canStart: boolean;
      readonly isSoloRoom: boolean;
      readonly someoneElseWatching: boolean;
      readonly roomPositionKnown: boolean;
      readonly leaving: boolean;
      readonly lobbyHint: string;
      readonly startPlayback: () => Promise<boolean>;
      readonly leaveLobby: () => void;
      readonly getParticipantStatus: typeof getParticipantStatus;
    };

/**
 * React glue for the Watch Together lobby: room/user queries → session
 * enter/exit + lobby context, and a presentational view-model derived from
 * {@link useSessionState}.
 */
export function useWatchTogetherLobby(roomId: string): LobbyViewModel {
  const router = useRouter();
  const sessionState = useSessionState();

  const roomQuery = api.plex.getWatchTogetherRoom.useQuery(
    { roomId },
    {
      // Poll for participant/room updates. Keep polling even after an error so a
      // transient network hiccup recovers on the next interval (don't latch the
      // lobby into "room unavailable" on a single failure).
      refetchInterval: 10_000,
    },
  );
  const userInfoQuery = api.plex.getUserInfo.useQuery(undefined, {
    staleTime: 60_000,
  });
  const room = roomQuery.data;
  const media = useWatchTogetherRoomMedia(room?.sourceUri);
  const source = media.source;
  const localUserId = userInfoQuery.data?.id;
  const pendingStartRoomIdRef = useRef<string | null>(null);

  const localUser: SyncplayUser | null = (() => {
    if (localUserId === undefined) {
      return null;
    }
    return {
      id: localUserId,
      deviceIdentifier: getPlexClientIdentifier(),
      deviceName: MULTIPLEX_SYNCPLAY_DEVICE_NAME,
    };
  })();

  // Enter once room + localUser resolve; re-enter when we return to Idle after
  // closing the player (leave → Idle). enterLobby is idempotent by room id so
  // refetches only refresh the room object without reconnecting; while Playing
  // it is a no-op (driver owns the socket).
  useEffect(() => {
    const currentRoom = roomQuery.data;
    if (!currentRoom || !localUser) {
      return;
    }
    sessionCommands.enterLobby({ room: currentRoom, localUser });
  }, [roomQuery.data, localUser, sessionState._tag]);

  // Always queue cleanup after enter/start. Room guards keep delayed cleanup
  // from touching a replacement session.
  useEffect(() => {
    return () => {
      if (pendingStartRoomIdRef.current === roomId) {
        sessionCommands.leave({
          suppressAutoStart: false,
          expectedRoomId: roomId,
        });
      } else {
        sessionCommands.exitLobby({ expectedRoomId: roomId });
      }
    };
  }, [roomId]);

  // After episode rotation the previous room is deleted. Keep the address bar
  // on the live room via replaceState only — soft-navigating while Playing
  // remounts this lobby under the modal and breaks Syncplay pause sync.
  useEffect(() => {
    if (sessionState._tag !== "Playing" || sessionState.room.id === roomId) {
      return;
    }
    const href = getWatchTogetherRoomHref(sessionState.room.id);
    if (window.location.pathname !== href) {
      window.history.replaceState(window.history.state, "", href);
    }
  }, [roomId, sessionState]);

  const sessionParticipants: ParticipantMap = (() => {
    if (
      (sessionState._tag === "Lobby" || sessionState._tag === "Playing") &&
      sessionState.room.id === roomId
    ) {
      return sessionState.participants;
    }
    return {};
  })();

  const roomPositionSeconds =
    sessionState._tag === "Lobby" && sessionState.room.id === roomId
      ? sessionState.roomPositionSeconds
      : null;
  const roomPositionKnown = roomPositionSeconds !== null;

  const isPlayingThisRoom =
    sessionState._tag === "Playing" && sessionState.room.id === roomId;

  const details = media.details;
  const playTarget = details?.playTarget;
  const serverId = source?.serverId;
  const serverUrl = details?.serverUrl;
  const authToken = details?.authToken;
  const canStartMedia = Boolean(
    room && playTarget && serverId && serverUrl && authToken && localUser,
  );
  // While Playing, Start is gated (session already open) — same as old
  // `session` truthiness check.
  const canStart = canStartMedia && !isPlayingThisRoom;
  const solo = room ? isSoloRoom(room) : false;

  const playbackItem = (() => {
    if (!playTarget || !serverId || !serverUrl || !authToken) {
      return null;
    }
    return createMediaPlayerItem(playTarget, {
      serverId,
      serverUrl,
      authToken,
    });
  })();

  const utils = api.useUtils();
  const leaveActiveSession = async (targetRoomId: string): Promise<void> => {
    if (!isSessionForRoom(sessionCommands.snapshot(), targetRoomId)) {
      return;
    }
    await sessionCommands.leave({
      suppressAutoStart: false,
      expectedRoomId: targetRoomId,
    }).completion;
  };
  const leaveRoom = api.plex.deleteWatchTogetherRoom.useMutation({
    onSuccess: async (_data, variables) => {
      await utils.plex.getWatchTogetherRooms.invalidate();
      await leaveActiveSession(variables.roomId);
      // Always navigate home on an explicit Leave click. After rotation the URL
      // room may already be gone and the session room may differ; stranding the
      // viewer on "unavailable" is worse than going home.
      router.push("/");
    },
    onError: async (_error, variables) => {
      // Delete may fail because rotation already removed the room — still leave
      // the live session when this lobby was targeting it.
      const target = resolveLobbyLeaveTarget(
        sessionCommands.snapshot(),
        roomId,
      );
      if (target.leaveSession) {
        await leaveActiveSession(target.roomId);
      } else {
        await leaveActiveSession(variables.roomId);
      }
      router.push("/");
      toast.error("Couldn't remove the session, but you've left it.");
    },
  });
  const leaving = leaveRoom.isPending;

  useEffect(() => {
    sessionCommands.setLobbyContext({
      canStart,
      playbackInput: canStart && playbackItem ? { item: playbackItem } : null,
      leaving,
    });
  }, [canStart, playbackItem, leaving, leaveRoom.isPending]);

  const startPlayback = async () => {
    if (!room || !localUser || !playbackItem || !canStartMedia) {
      return false;
    }

    const joiningInProgress = isSomeoneElseWatching(
      room,
      sessionParticipants,
      localUser.id,
    );
    if (joiningInProgress && !roomPositionKnown) {
      return false;
    }

    pendingStartRoomIdRef.current = room.id;
    return sessionCommands
      .startPlayback({
        room,
        localUser,
        item: playbackItem,
        resume: false,
        ...(joiningInProgress && roomPositionSeconds !== null
          ? { startPositionSeconds: roomPositionSeconds }
          : {}),
      })
      .completion.finally(() => {
        if (pendingStartRoomIdRef.current === room.id) {
          pendingStartRoomIdRef.current = null;
        }
      });
  };

  const leaveLobby = () => {
    if (leaving) {
      return;
    }
    const target = resolveLobbyLeaveTarget(sessionCommands.snapshot(), roomId);
    leaveRoom.mutate({ roomId: target.roomId });
  };

  const participantsByUserId = mergeParticipantsByUserId(sessionParticipants);

  const allInvitedPresentNow = Boolean(
    room &&
      localUserId !== undefined &&
      allInvitedPresent(room, sessionParticipants, localUserId),
  );

  const allInvitedPresentSticky =
    sessionState._tag === "Lobby" && sessionState.room.id === roomId
      ? sessionState.everyonePresentSticky
      : false;

  if (
    roomQuery.isPending ||
    userInfoQuery.isPending ||
    userInfoQuery.isLoading
  ) {
    return { status: "loading" };
  }

  if (
    roomQuery.isError ||
    userInfoQuery.isError ||
    !room ||
    !source ||
    localUserId === undefined ||
    !localUser
  ) {
    return { status: "unavailable" };
  }

  const someoneElse = isSomeoneElseWatching(
    room,
    sessionParticipants,
    localUserId,
  );
  // Re-read on every sessionState-driven render (leave/start always change it).
  const autoStartSuppressed =
    sessionCommands.getSuppressedRoomId() === roomId && !isPlayingThisRoom;

  const lobbyHint = getLobbyHint({
    everyonePresent: allInvitedPresentSticky,
    everyonePresentNow: allInvitedPresentNow,
    canStart,
    autoStartSuppressed,
    someoneElseWatching: someoneElse,
    isSoloRoom: solo,
  });

  return {
    status: "ready",
    room,
    localUserId,
    media,
    participantsByUserId,
    canStart,
    isSoloRoom: solo,
    someoneElseWatching: someoneElse,
    roomPositionKnown,
    leaving,
    lobbyHint,
    startPlayback,
    leaveLobby,
    getParticipantStatus,
  };
}
