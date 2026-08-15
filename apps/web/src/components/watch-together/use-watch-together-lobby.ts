"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { useWatchTogetherRoomMedia } from "~/components/watch-together/use-watch-together-room-media";
import { toastManager } from "~/components/ui/toast-manager";
import {
  isSessionForRoom,
  resolveLobbyLeaveTarget,
} from "~/components/watch-together/watch-together-lobby-leave";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { usePlexClientIdentifier } from "~/lib/device-identifier";
import { sessionCommands, useSessionState } from "~/lib/effect/session-atoms";
import {
  refetchSyncedWatchTogetherRooms,
  removeSyncedWatchTogetherRoom,
  useSyncedUserInfo,
  useSyncedWatchTogetherRoom,
  useSyncEngineCollections,
} from "~/lib/sync-engine";
import { readGuestHostCapability } from "~/lib/watch-together-source";
import { api } from "~/trpc/api";

async function leaveActiveWatchTogetherSession(
  targetRoomId: string,
): Promise<void> {
  if (!isSessionForRoom(sessionCommands.snapshot(), targetRoomId)) {
    return;
  }
  await sessionCommands.leave({
    suppressAutoStart: false,
    expectedRoomId: targetRoomId,
  }).completion;
}

export type LobbyViewModel =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | {
      readonly status: "ready";
      readonly room: WatchTogetherRoom;
      readonly localUserId: number;
      readonly media: ReturnType<typeof useWatchTogetherRoomMedia>;
      readonly participantsByUserId: Map<number, SyncplayParticipantState>;
      readonly participantDevices: ParticipantMap;
      readonly guestLink: null | {
        readonly joinPath: string;
        readonly guestUserId: number;
      };
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
 * Presentational lobby glue for a route `roomId`: queries, Start/Leave, and
 * lobby auto-start context. Session enter/exit + URL follow live in
 * {@link WatchTogetherSessionShell} so soft-nav can remount this hook safely.
 */
export function useWatchTogetherLobby(roomId: string): LobbyViewModel {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionState = useSessionState();
  const deviceIdentifier = usePlexClientIdentifier();

  // Rooms collection polls every 10s; warm single-room on miss.
  const roomQuery = useSyncedWatchTogetherRoom(roomId);
  const userInfoQuery = useSyncedUserInfo();
  const collections = useSyncEngineCollections();
  const room = roomQuery.room;
  const media = useWatchTogetherRoomMedia(room?.sourceUri);
  const source = media.source;
  const localUserId = userInfoQuery.data?.id;
  const pendingStartRoomIdRef = useRef<string | null>(null);
  const queryCapability = searchParams.get("guest");
  const storedGuestCapability = useSyncExternalStore<string | null | undefined>(
    subscribeGuestCapability,
    () => readGuestHostCapability(roomId),
    () => undefined,
  );
  const guestCapability = queryCapability ?? storedGuestCapability;
  const hostContextQuery = api.guestWatchTogether.hostContext.useQuery(
    { capability: guestCapability ?? "" },
    {
      enabled: typeof guestCapability === "string",
      staleTime: 30_000,
      retry: 1,
      retryDelay: 250,
    },
  );

  const localUser: SyncplayUser | null = (() => {
    if (localUserId === undefined || !deviceIdentifier) {
      return null;
    }
    return {
      id: localUserId,
      deviceIdentifier,
      deviceName: MULTIPLEX_SYNCPLAY_DEVICE_NAME,
    };
  })();

  // If Start is in flight and this lobby unmounts, leave that room. Session
  // enter/exit for idle lobby browsing is owned by WatchTogetherSessionShell.
  useEffect(() => {
    return () => {
      if (pendingStartRoomIdRef.current === roomId) {
        sessionCommands.leave({
          suppressAutoStart: false,
          expectedRoomId: roomId,
        });
      }
    };
  }, [roomId]);

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
  const guestHostContextReady =
    guestCapability !== undefined &&
    (guestCapability === null ||
      (hostContextQuery.data?.valid === true &&
        hostContextQuery.data.roomId === roomId));
  // Start is gated while any playback session is active (player owns the
  // session; lobby under the modal must not open a second one). A Guest Link
  // host also cannot start until its signed room context is validated, or a
  // reload could briefly launch with the ordinary room policy.
  const canStart =
    canStartMedia && guestHostContextReady && sessionState._tag !== "Playing";
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

  const leaveRoom = api.plex.deleteWatchTogetherRoom.useMutation({
    onSuccess: async (_data, variables) => {
      if (collections) {
        removeSyncedWatchTogetherRoom(collections, variables.roomId);
      }
      await refetchSyncedWatchTogetherRooms().catch(() => undefined);
      await leaveActiveWatchTogetherSession(variables.roomId).catch(
        () => undefined,
      );
      router.push("/");
    },
    onError: async (_error, variables) => {
      // Delete may fail because rotation already removed the room — still leave
      // when the mutation targeted a live session room.
      await leaveActiveWatchTogetherSession(variables.roomId).catch(
        () => undefined,
      );
      router.push("/");
      toastManager.add({
        title: "Couldn't remove the session, but you've left it.",
        type: "error",
      });
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
    if (!room || !localUser || !playbackItem || !canStart) {
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

  if (roomQuery.isPending || userInfoQuery.isLoading) {
    return { status: "loading" };
  }

  if (
    roomQuery.isError ||
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
  const guestLink =
    hostContextQuery.data?.valid && hostContextQuery.data.roomId === roomId
      ? {
          joinPath: hostContextQuery.data.joinPath,
          guestUserId: hostContextQuery.data.guestUserId,
        }
      : null;

  return {
    status: "ready",
    room,
    localUserId,
    media,
    participantsByUserId,
    participantDevices: sessionParticipants,
    guestLink,
    canStart,
    isSoloRoom: solo,
    someoneElseWatching: someoneElse,
    roomPositionKnown,
    leaving,
    lobbyHint: guestLink
      ? "You control when playback starts. Guests will follow automatically."
      : lobbyHint,
    startPlayback,
    leaveLobby,
    getParticipantStatus,
  };
}

function subscribeGuestCapability(): () => void {
  return () => undefined;
}
