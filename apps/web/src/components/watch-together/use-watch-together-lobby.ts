"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MULTIPLEX_SYNCPLAY_DEVICE_NAME,
  PRESENCE_GRACE_MS,
  allInvitedPresent,
  getLobbyHint,
  getParticipantStatus,
  isSoloRoom,
  isSomeoneElseWatching,
  type ParticipantMap,
  type SyncplayParticipantState,
  type SyncplayUser,
  type WatchTogetherRoom,
} from "@multiplex/plex-query";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { toast } from "sonner";

import { useWatchTogetherRoomMedia } from "~/components/watch-together/use-watch-together-room-media";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { getPlexClientIdentifier } from "~/lib/device-identifier";
import { isAsyncResultLoading } from "~/lib/effect/async-result";
import {
  deleteWatchTogetherRoom,
  userInfoAtom,
  watchTogetherRoomAtom,
} from "~/lib/effect/plex-atoms";
import { watchTogetherRoomWriteKeys } from "~/lib/effect/reactivity-keys";
import { sessionCommands, useSessionState } from "~/lib/effect/session-atoms";

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
      readonly startPlayback: () => boolean;
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
  const [leaving, setLeaving] = useState(false);

  const roomResult = useAtomValue(watchTogetherRoomAtom(roomId));
  const userInfoResult = useAtomValue(userInfoAtom);
  const deleteRoom = useAtomSet(deleteWatchTogetherRoom, {
    mode: "promiseExit",
  });

  const room = Option.getOrUndefined(AsyncResult.value(roomResult));
  const userInfo = Option.getOrUndefined(AsyncResult.value(userInfoResult));
  const media = useWatchTogetherRoomMedia(room?.sourceUri);
  const source = media.source;
  const localUserId = userInfo?.id;

  const localUser = useMemo<SyncplayUser | null>(() => {
    if (localUserId === undefined) {
      return null;
    }
    return {
      id: localUserId,
      deviceIdentifier: getPlexClientIdentifier(),
      deviceName: MULTIPLEX_SYNCPLAY_DEVICE_NAME,
    };
  }, [localUserId]);

  // Enter once room + localUser resolve; re-enter when we return to Idle after
  // closing the player (leave → Idle). enterLobby is idempotent by room id so
  // refetches only refresh the room object without reconnecting; while Playing
  // it is a no-op (driver owns the socket).
  useEffect(() => {
    if (!room || !localUser) {
      return;
    }
    sessionCommands.enterLobby({ room, localUser });
  }, [room, localUser, sessionState._tag]);

  // Exit only on unmount / roomId change, and only if still in Lobby for this
  // room — Playing outlives the lobby page under the player modal.
  useEffect(() => {
    return () => {
      const snap = sessionCommands.snapshot();
      if (snap._tag === "Lobby" && snap.room.id === roomId) {
        sessionCommands.exitLobby();
      }
    };
  }, [roomId]);

  const sessionParticipants: ParticipantMap = useMemo(() => {
    if (
      (sessionState._tag === "Lobby" || sessionState._tag === "Playing") &&
      sessionState.room.id === roomId
    ) {
      return sessionState.participants;
    }
    return {};
  }, [sessionState, roomId]);

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

  const playbackItem = useMemo(() => {
    if (!playTarget || !serverId || !serverUrl || !authToken) {
      return null;
    }
    return createMediaPlayerItem(playTarget, {
      serverId,
      serverUrl,
      authToken,
    });
  }, [playTarget, serverId, serverUrl, authToken]);

  useEffect(() => {
    sessionCommands.setLobbyContext({
      canStart,
      playbackInput: canStart && playbackItem ? { item: playbackItem } : null,
      leaving,
    });
  }, [canStart, playbackItem, leaving]);

  const startPlayback = useCallback(() => {
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

    sessionCommands.startPlayback({
      room,
      localUser,
      item: playbackItem,
      resume: false,
      ...(joiningInProgress && roomPositionSeconds !== null
        ? { startPositionSeconds: roomPositionSeconds }
        : {}),
    });
    return true;
  }, [
    room,
    localUser,
    playbackItem,
    canStartMedia,
    sessionParticipants,
    roomPositionKnown,
    roomPositionSeconds,
  ]);

  const leaveLobby = useCallback(() => {
    if (leaving) {
      return;
    }
    setLeaving(true);
    void (async () => {
      const exit = await deleteRoom({
        params: { roomId },
        reactivityKeys: watchTogetherRoomWriteKeys,
      });
      if (Exit.isFailure(exit)) {
        sessionCommands.leave({ suppressAutoStart: false });
        router.push("/");
        toast.error("Couldn't remove the session, but you've left it.");
        setLeaving(false);
        return;
      }
      sessionCommands.leave({ suppressAutoStart: false });
      router.push("/");
    })();
  }, [leaving, deleteRoom, roomId, router]);

  const participantsByUserId = useMemo(
    () =>
      new Map(
        Object.values(sessionParticipants).map((state) => [
          state.user.id,
          state,
        ]),
      ),
    [sessionParticipants],
  );

  const allInvitedPresentNow = Boolean(
    room &&
      localUserId !== undefined &&
      allInvitedPresent(room, sessionParticipants, localUserId),
  );

  // Sticky presence for the hint only (auto-start sticky lives in the service).
  const [allInvitedPresentSticky, setAllInvitedPresentSticky] = useState(false);
  useEffect(() => {
    if (allInvitedPresentNow) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- safe debounce: idempotent flip-on; the flip-off below is delayed
      setAllInvitedPresentSticky(true);
      return;
    }
    const timer = setTimeout(
      () => setAllInvitedPresentSticky(false),
      PRESENCE_GRACE_MS,
    );
    return () => clearTimeout(timer);
  }, [allInvitedPresentNow]);

  if (
    isAsyncResultLoading(roomResult) ||
    isAsyncResultLoading(userInfoResult)
  ) {
    return { status: "loading" };
  }

  if (
    AsyncResult.isFailure(roomResult) ||
    AsyncResult.isFailure(userInfoResult) ||
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
