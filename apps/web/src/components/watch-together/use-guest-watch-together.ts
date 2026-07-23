"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
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

function guestDeviceName(deviceName: string): string {
  return deviceName.replace(/^Multiplex Guest ·\s*/, "") || "Guest";
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
  const [pendingContinuation, setPendingContinuation] = useState<{
    capability: string;
    value: GuestWatchTogetherBootstrapValue;
  } | null>(null);
  const swappingRef = useRef(false);
  const joiningRef = useRef(false);
  const joined = joinState.status === "joined" ? joinState.value : null;
  const deviceIdentifier =
    joinState.status === "joined" ? joinState.deviceIdentifier : null;
  const playbackItem = joined
    ? createMediaPlayerItem(joined.item, {
        serverId: joined.serverId,
        serverUrl: joined.serverUrl,
        authToken: joined.authToken,
        access: "guest-transient",
      })
    : null;

  useEffect(() => {
    if (!joined || !playbackItem || !deviceIdentifier) {
      return;
    }
    const localUser = createGuestSyncplayUser({
      guestUserId: joined.guest.id,
      nickname,
      deviceIdentifier,
    });
    sessionCommands.enterLobby({
      room: joined.room,
      localUser,
      startPolicy: {
        _tag: "HostControlled",
        localRole: "Guest",
        hostUserId: joined.host.id,
        guestUserId: joined.guest.id,
      },
    });
    sessionCommands.setLobbyContext({
      canStart: true,
      playbackInput: { item: playbackItem },
      leaving: false,
    });

    return () => {
      sessionCommands.setLobbyContext({
        canStart: false,
        playbackInput: null,
        leaving: false,
      });
      sessionCommands.exitLobby({ expectedRoomId: joined.room.id });
    };
  }, [deviceIdentifier, joined, nickname, playbackItem]);

  useEffect(() => {
    if (
      !joined?.nextEpisode ||
      sessionState._tag !== "Playing" ||
      sessionState.room.id !== joined.room.id ||
      pendingContinuation
    ) {
      return;
    }

    let done = false;
    const controller = new AbortController();
    const nextRatingKey = joined.nextEpisode.ratingKey;

    const poll = async () => {
      if (done) return;
      try {
        const response = await fetch("/api/watch-together/guest/continue", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            capability: activeCapability,
            nextRatingKey,
          }),
          signal: controller.signal,
        });
        // Non-OK responses are retried on the next interval tick; the current
        // room remains playable while discovery continues.
        if (!response.ok) return;
        const body: unknown = await response.json();
        const parsed =
          guestWatchTogetherContinuationResponseSchema.safeParse(body);
        if (done) return;
        if (parsed.success && parsed.data.ok) {
          done = true;
          setPendingContinuation(parsed.data);
        }
      } catch {
        // AbortError on unmount is expected; other failures retry on interval.
      }
    };

    void poll();
    const intervalId = setInterval(() => void poll(), 4_000);

    return () => {
      done = true;
      controller.abort();
      clearInterval(intervalId);
    };
  }, [activeCapability, joined, pendingContinuation, sessionState]);

  useEffect(() => {
    if (
      !joined ||
      !pendingContinuation ||
      swappingRef.current ||
      sessionState._tag !== "Playing" ||
      sessionState.room.id !== joined.room.id ||
      duration <= 0 ||
      duration - currentTime > 0.75
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
        setPendingContinuation(null);
        window.history.replaceState(
          window.history.state,
          "",
          `/watch-together/guest/${encodeURIComponent(pendingContinuation.capability)}`,
        );
      })
      .finally(() => {
        swappingRef.current = false;
      });
  }, [currentTime, duration, joined, pendingContinuation, sessionState]);

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
