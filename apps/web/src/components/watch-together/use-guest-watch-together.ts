"use client";

import { useQuery } from "@tanstack/react-query";
import {
  isAtEnd,
  isInLeadWindow,
  type SessionState,
} from "@multiplex/plex-query";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import { shallow } from "zustand/shallow";

import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { sessionCommands, useSessionState } from "~/lib/effect/session-atoms";
import { usePlayerStateSelector } from "~/lib/effect/player-atoms";
import {
  createGuestDeviceIdentifier,
  createGuestSyncplayUser,
} from "~/lib/guest-syncplay-user";
import {
  guestWatchTogetherBootstrapResponseSchema,
  guestWatchTogetherContinuationResponseSchema,
  type GuestWatchTogetherBootstrapValue,
} from "~/lib/guest-watch-together-bootstrap";

type JoinState =
  | { readonly status: "form" }
  | { readonly status: "joining" }
  | {
      readonly status: "joined";
      readonly value: GuestWatchTogetherBootstrapValue;
      readonly deviceIdentifier: string;
    }
  | { readonly status: "unavailable"; readonly message: string };

type GuestLobbyEntry = Parameters<typeof sessionCommands.enterLobby>[0];

type GuestContinuation = {
  readonly capability: string;
  readonly value: GuestWatchTogetherBootstrapValue;
};

export type GuestLobbyEntryCommands = Pick<
  typeof sessionCommands,
  "enterLobby" | "snapshot"
>;

/**
 * Enter a guest lobby at most once while the lifecycle command is pending.
 * The snapshot check keeps ordinary session updates from re-entering, while
 * an unexpected transition back to Idle can request a fresh observer.
 */
export function requestGuestLobbyEntry(
  commands: GuestLobbyEntryCommands,
  pendingRoomIdRef: RefObject<string | null>,
  entry: GuestLobbyEntry,
): void {
  const current = commands.snapshot();
  if (
    ((current._tag === "Lobby" || current._tag === "Playing") &&
      current.room.id === entry.room.id) ||
    pendingRoomIdRef.current === entry.room.id
  ) {
    return;
  }

  const roomId = entry.room.id;
  pendingRoomIdRef.current = roomId;
  const clearPending = () => {
    if (pendingRoomIdRef.current === roomId) {
      pendingRoomIdRef.current = null;
    }
  };
  void commands.enterLobby(entry).completion.then(clearPending, clearPending);
}

export function getGuestRotationTimeline(input: {
  readonly localCurrentTimeSeconds: number;
  readonly localDurationSeconds: number;
  readonly itemDurationMilliseconds?: number;
  readonly sessionState: SessionState;
}) {
  const localCurrentTimeSeconds =
    Number.isFinite(input.localCurrentTimeSeconds) &&
    input.localCurrentTimeSeconds > 0
      ? input.localCurrentTimeSeconds
      : 0;
  let currentTimeSeconds = localCurrentTimeSeconds;

  if (
    input.sessionState._tag === "Playing" &&
    input.sessionState.startPolicy._tag === "HostControlled"
  ) {
    const hostUserId = input.sessionState.startPolicy.hostUserId;
    for (const participant of Object.values(input.sessionState.participants)) {
      if (
        participant.isPresent === true &&
        participant.user.id === hostUserId &&
        participant.positionSeconds !== undefined &&
        Number.isFinite(participant.positionSeconds)
      ) {
        currentTimeSeconds = Math.max(
          currentTimeSeconds,
          participant.positionSeconds,
        );
      }
    }
  }

  const metadataDurationSeconds =
    input.itemDurationMilliseconds !== undefined &&
    Number.isFinite(input.itemDurationMilliseconds) &&
    input.itemDurationMilliseconds > 0
      ? input.itemDurationMilliseconds / 1_000
      : 0;
  const durationSeconds =
    Number.isFinite(input.localDurationSeconds) &&
    input.localDurationSeconds > 0
      ? input.localDurationSeconds
      : metadataDurationSeconds;
  const timeRemainingSeconds = durationSeconds - currentTimeSeconds;

  return {
    currentTimeSeconds,
    durationSeconds,
    timeRemainingSeconds,
    inLeadWindow: isInLeadWindow({
      durationSeconds,
      currentTimeSeconds,
      timeRemainingSeconds,
    }),
    atEnd: isAtEnd({ durationSeconds, timeRemainingSeconds }),
  };
}

/**
 * A host can replace its player and leave the old Syncplay room before its
 * final seek heartbeat reaches a Guest Link viewer. Once the continuation is
 * ready, an explicit host departure is therefore also an authoritative
 * handoff signal. Requiring an observed `isPresent: false` avoids treating an
 * initially empty or reconnecting participant snapshot as an episode end.
 */
export function shouldSwapGuestContinuation(input: {
  readonly atEnd: boolean;
  readonly roomId: string;
  readonly hostUserId: number;
  readonly sessionState: SessionState;
}): boolean {
  if (input.atEnd) return true;
  if (
    input.sessionState._tag !== "Playing" ||
    input.sessionState.room.id !== input.roomId ||
    input.sessionState.startPolicy._tag !== "HostControlled" ||
    input.sessionState.startPolicy.localRole !== "Guest"
  ) {
    return false;
  }

  return Object.values(input.sessionState.participants).some(
    (participant) =>
      participant.user.id === input.hostUserId &&
      participant.isPresent === false,
  );
}

function guestDeviceName(deviceName: string): string {
  return deviceName.replace(/^Multiplex Guest ·\s*/, "") || "Guest";
}

function createGuestLobbySession(input: {
  readonly joined: GuestWatchTogetherBootstrapValue;
  readonly nickname: string;
  readonly deviceIdentifier: string;
}) {
  const { joined, nickname, deviceIdentifier } = input;
  return {
    playbackItem: createMediaPlayerItem(joined.item, {
      serverId: joined.serverId,
      serverUrl: joined.serverUrl,
      authToken: joined.authToken,
      access: "guest-transient",
    }),
    entry: {
      room: joined.room,
      localUser: createGuestSyncplayUser({
        guestUserId: joined.guest.id,
        nickname,
        deviceIdentifier,
      }),
      startPolicy: {
        _tag: "HostControlled",
        localRole: "Guest",
        hostUserId: joined.host.id,
        guestUserId: joined.guest.id,
      },
    },
  } satisfies {
    readonly entry: GuestLobbyEntry;
    readonly playbackItem: ReturnType<typeof createMediaPlayerItem>;
  };
}

async function fetchGuestContinuation(input: {
  readonly capability: string;
  readonly nextRatingKey?: string;
  readonly signal: AbortSignal;
}): Promise<GuestContinuation | null> {
  try {
    const response = await fetch("/api/watch-together/guest/continue", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capability: input.capability,
        nextRatingKey: input.nextRatingKey,
      }),
      signal: input.signal,
    });
    // Non-OK responses are retried on the next interval tick; the current
    // room remains playable while discovery continues.
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = guestWatchTogetherContinuationResponseSchema.safeParse(body);
    return parsed.success && parsed.data.ok ? parsed.data : null;
  } catch {
    // AbortError on unmount is expected; other failures retry on interval.
    return null;
  }
}

export function useGuestWatchTogether(capability: string) {
  const sessionState = useSessionState();
  const { currentTime, duration } = usePlayerStateSelector(
    (state) => ({
      currentTime: state.currentTime,
      duration: state.duration,
    }),
    shallow,
  );
  const [nickname, setNickname] = useState("");
  const [joinState, setJoinState] = useState<JoinState>({ status: "form" });
  const [activeCapability, setActiveCapability] = useState(capability);
  const [continuationPollingRoomId, setContinuationPollingRoomId] = useState<
    string | null
  >(null);
  const swappingRef = useRef(false);
  const joiningRef = useRef(false);
  const pendingLobbyRoomIdRef = useRef<string | null>(null);
  const joined = joinState.status === "joined" ? joinState.value : null;
  const deviceIdentifier =
    joinState.status === "joined" ? joinState.deviceIdentifier : null;
  const rotationTimeline = getGuestRotationTimeline({
    localCurrentTimeSeconds: currentTime,
    localDurationSeconds: duration,
    itemDurationMilliseconds: joined?.item.duration,
    sessionState,
  });
  const playingJoinedRoom =
    joined !== null &&
    sessionState._tag === "Playing" &&
    sessionState.room.id === joined.room.id;
  const shouldSwapContinuation =
    joined !== null &&
    shouldSwapGuestContinuation({
      atEnd: rotationTimeline.atEnd,
      roomId: joined.room.id,
      hostUserId: joined.host.id,
      sessionState,
    });
  const shouldPollContinuation =
    joined !== null && continuationPollingRoomId === joined.room.id;
  const { data: pendingContinuation = null } = useQuery({
    queryKey: [
      "guest-watch-together-continuation",
      activeCapability,
      joined?.room.id,
      joined?.nextEpisode?.ratingKey,
    ],
    queryFn: ({ signal }) =>
      fetchGuestContinuation({
        capability: activeCapability,
        nextRatingKey: joined?.nextEpisode?.ratingKey,
        signal,
      }),
    enabled: shouldPollContinuation,
    refetchInterval: (query) => (query.state.data ? false : 4_000),
    refetchIntervalInBackground: true,
    retry: false,
  });

  useEffect(() => {
    if (!joined || !deviceIdentifier) {
      return;
    }
    const session = createGuestLobbySession({
      joined,
      nickname,
      deviceIdentifier,
    });
    requestGuestLobbyEntry(
      sessionCommands,
      pendingLobbyRoomIdRef,
      session.entry,
    );
    sessionCommands.setLobbyContext({
      canStart: true,
      playbackInput: { item: session.playbackItem },
      leaving: false,
    });

    const roomId = session.entry.room.id;

    return () => {
      sessionCommands.setLobbyContext({
        canStart: false,
        playbackInput: null,
        leaving: false,
      });
      sessionCommands.exitLobby({ expectedRoomId: roomId });
    };
  }, [deviceIdentifier, joined, nickname]);

  useEffect(() => {
    if (!joined || !deviceIdentifier || sessionState._tag !== "Idle") {
      return;
    }
    const session = createGuestLobbySession({
      joined,
      nickname,
      deviceIdentifier,
    });
    requestGuestLobbyEntry(
      sessionCommands,
      pendingLobbyRoomIdRef,
      session.entry,
    );
  }, [deviceIdentifier, joined, nickname, sessionState._tag]);

  useEffect(() => {
    if (
      !joined ||
      !playingJoinedRoom ||
      continuationPollingRoomId === joined.room.id ||
      (!rotationTimeline.inLeadWindow &&
        !rotationTimeline.atEnd &&
        !shouldSwapContinuation)
    ) {
      return;
    }

    const roomId = joined.room.id;
    // Once the room enters its handoff window, keep discovery armed. The host
    // leaving the old Syncplay room changes participant/timeline state and
    // must not abort the continuation request that observes its successor.
    const timeoutId = window.setTimeout(
      () => setContinuationPollingRoomId(roomId),
      0,
    );
    return () => window.clearTimeout(timeoutId);
  }, [
    continuationPollingRoomId,
    joined,
    playingJoinedRoom,
    rotationTimeline.atEnd,
    rotationTimeline.inLeadWindow,
    shouldSwapContinuation,
  ]);

  useEffect(() => {
    if (
      !joined ||
      !pendingContinuation ||
      swappingRef.current ||
      !playingJoinedRoom ||
      !shouldSwapContinuation
    ) {
      return;
    }

    const nextPlaybackItem = createMediaPlayerItem(
      pendingContinuation.value.item,
      {
        serverId: pendingContinuation.value.serverId,
        serverUrl: pendingContinuation.value.serverUrl,
        authToken: pendingContinuation.value.authToken,
        access: "guest-transient",
      },
    );
    swappingRef.current = true;
    void sessionCommands
      .swapTo({
        room: pendingContinuation.value.room,
        item: nextPlaybackItem,
        expectedCurrent: {
          roomId: joined.room.id,
          serverId: joined.serverId,
          ratingKey: joined.item.ratingKey,
        },
      })
      .completion.then(() => {
        const current = sessionCommands.snapshot();
        if (
          current._tag !== "Playing" ||
          current.room.id !== pendingContinuation.value.room.id
        ) {
          return;
        }
        setJoinState((state) =>
          state.status === "joined"
            ? { ...state, value: pendingContinuation.value }
            : state,
        );
        setActiveCapability(pendingContinuation.capability);
        setContinuationPollingRoomId(null);
        window.history.replaceState(
          window.history.state,
          "",
          `/watch-together/guest/${encodeURIComponent(pendingContinuation.capability)}`,
        );
      })
      .finally(() => {
        swappingRef.current = false;
      });
  }, [joined, pendingContinuation, playingJoinedRoom, shouldSwapContinuation]);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = nickname.trim();
    if (!displayName || joinState.status === "joining" || joiningRef.current) {
      return;
    }
    joiningRef.current = true;
    const nextDeviceIdentifier = createGuestDeviceIdentifier();
    setJoinState({ status: "joining" });

    const nextState = await (async (): Promise<JoinState> => {
      try {
        const response = await fetch("/api/watch-together/guest/bootstrap", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ capability: activeCapability }),
        });
        if (!response.ok) {
          return {
            status: "unavailable",
            message:
              "We couldn't reach the session. Check your connection and try again.",
          };
        }
        const body: unknown = await response.json();
        const parsed =
          guestWatchTogetherBootstrapResponseSchema.safeParse(body);
        if (!parsed.success) {
          return {
            status: "unavailable",
            message: "This Watch Together link returned an invalid response.",
          };
        }
        if (!parsed.data.ok) {
          const reason = parsed.data.reason;
          return {
            status: "unavailable",
            message:
              reason === "expired-invite"
                ? "This guest link has expired. Ask the host for a new one."
                : "This Watch Together link is no longer available.",
          };
        }
        return {
          status: "joined",
          value: parsed.data.value,
          deviceIdentifier: nextDeviceIdentifier,
        };
      } catch {
        return {
          status: "unavailable",
          message:
            "We couldn't reach the session. Check your connection and try again.",
        };
      }
    })();

    joiningRef.current = false;
    setJoinState(nextState);
  }

  const participants =
    joined &&
    (sessionState._tag === "Lobby" || sessionState._tag === "Playing") &&
    sessionState.room.id === joined.room.id
      ? Object.entries(sessionState.participants)
      : [];
  const hostWatching = joined
    ? participants.some(
        ([, participant]) =>
          participant.user.id === joined.host.id && participant.isReady,
      )
    : false;
  const guestDevices: {
    id: string;
    name: string;
    local: boolean;
  }[] = [];
  if (joined) {
    for (const [id, participant] of participants) {
      if (participant.user.id === joined.guest.id && participant.isPresent) {
        guestDevices.push({
          id,
          name: guestDeviceName(participant.user.deviceName),
          local: participant.user.deviceIdentifier === deviceIdentifier,
        });
      }
    }
  }

  return {
    nickname,
    setNickname,
    joinState,
    setJoinState,
    joined,
    hostWatching,
    guestDevices,
    join,
  };
}
