"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Loader2, Play, ShieldAlert, UserRound, Users } from "lucide-react";
import { shallow } from "zustand/shallow";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
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

export function GuestWatchTogetherPage({ capability }: { capability: string }) {
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
  const joined = joinState.status === "joined" ? joinState.value : null;
  const deviceIdentifier =
    joinState.status === "joined" ? joinState.deviceIdentifier : null;
  const playbackItem = useMemo(
    () =>
      joined
        ? createMediaPlayerItem(joined.item, {
            serverId: joined.serverId,
            serverUrl: joined.serverUrl,
            authToken: joined.authToken,
            access: "guest-transient",
          })
        : null,
    [joined],
  );

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

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch("/api/watch-together/guest/continue", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            capability: activeCapability,
            nextRatingKey: joined.nextEpisode?.ratingKey,
          }),
        });
        const body: unknown = await response.json();
        const parsed =
          guestWatchTogetherContinuationResponseSchema.safeParse(body);
        if (cancelled) return;
        if (parsed.success && parsed.data.ok) {
          setPendingContinuation(parsed.data);
          return;
        }
      } catch {
        // The current room remains playable while discovery retries.
      }
      if (!cancelled) {
        retryTimer = setTimeout(() => void poll(), 4_000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
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
    if (!displayName || joinState.status === "joining") {
      return;
    }
    const nextDeviceIdentifier = createGuestDeviceIdentifier();
    setJoinState({ status: "joining" });

    try {
      const response = await fetch("/api/watch-together/guest/bootstrap", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ capability: activeCapability }),
      });
      const body: unknown = await response.json();
      const parsed = guestWatchTogetherBootstrapResponseSchema.safeParse(body);
      if (!parsed.success) {
        setJoinState({
          status: "unavailable",
          message: "This Watch Together link returned an invalid response.",
        });
        return;
      }
      if (!parsed.data.ok) {
        const reason = parsed.data.reason;
        setJoinState({
          status: "unavailable",
          message:
            reason === "expired-invite"
              ? "This guest link has expired. Ask the host for a new one."
              : "This Watch Together link is no longer available.",
        });
        return;
      }
      setJoinState({
        status: "joined",
        value: parsed.data.value,
        deviceIdentifier: nextDeviceIdentifier,
      });
    } catch {
      setJoinState({
        status: "unavailable",
        message:
          "We couldn't reach the session. Check your connection and try again.",
      });
    }
  }

  if (joinState.status === "unavailable") {
    return (
      <GuestPageFrame>
        <ShieldAlert className="text-muted-foreground size-8" />
        <h1 className="text-2xl font-semibold">Session unavailable</h1>
        <p className="text-muted-foreground max-w-md text-center text-sm">
          {joinState.message}
        </p>
        <Button
          variant="outline"
          onClick={() => setJoinState({ status: "form" })}
        >
          Try again
        </Button>
      </GuestPageFrame>
    );
  }

  if (!joined) {
    return (
      <GuestPageFrame>
        <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
          <Users className="size-6" />
        </div>
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            Join Watch Together
          </h1>
          <p className="text-muted-foreground max-w-md text-sm leading-6">
            Enter a name so the host and other guests can recognize this device.
            You don&apos;t need a Plex account.
          </p>
        </div>
        <form className="w-full max-w-sm space-y-3" onSubmit={join}>
          <label className="block space-y-2 text-sm font-medium">
            Display name
            <div className="relative">
              <UserRound className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                autoFocus
                autoComplete="nickname"
                maxLength={40}
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                className="pl-9"
                placeholder="Your name"
              />
            </div>
          </label>
          <Button
            className="w-full active:scale-[0.98]"
            disabled={!nickname.trim() || joinState.status === "joining"}
            aria-busy={joinState.status === "joining" || undefined}
          >
            {joinState.status === "joining" ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <Play data-icon="inline-start" />
            )}
            Join session
          </Button>
        </form>
        <p className="text-muted-foreground max-w-sm text-center text-xs leading-5">
          This link grants temporary access to the host&apos;s Plex Guest
          profile. Only open links from someone you trust.
        </p>
      </GuestPageFrame>
    );
  }

  const participants =
    (sessionState._tag === "Lobby" || sessionState._tag === "Playing") &&
    sessionState.room.id === joined.room.id
      ? Object.entries(sessionState.participants)
      : [];
  const hostWatching = participants.some(
    ([, participant]) =>
      participant.user.id === joined.host.id && participant.isReady,
  );
  const guestDevices = participants.filter(
    ([, participant]) =>
      participant.user.id === joined.guest.id && participant.isPresent,
  );

  return (
    <GuestPageFrame>
      <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
        {hostWatching ? (
          <Play className="size-6" />
        ) : (
          <Users className="size-6" />
        )}
      </div>
      <div className="space-y-2 text-center">
        <p className="text-muted-foreground text-sm">
          {joined.host.title} invited you to
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {joined.item.title}
        </h1>
        <p className="text-muted-foreground text-sm">
          {hostWatching
            ? "The host started playback. Connecting your player…"
            : "You're in. Playback will begin when the host presses Start."}
        </p>
      </div>
      <div className="bg-card w-full max-w-md rounded-2xl border p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Guest devices</h2>
          <span className="text-muted-foreground text-xs">
            {Math.max(1, guestDevices.length)} connected
          </span>
        </div>
        <div className="space-y-2">
          {guestDevices.length === 0 ? (
            <GuestDeviceRow name={nickname.trim()} local />
          ) : (
            guestDevices.map(([id, participant]) => (
              <GuestDeviceRow
                key={id}
                name={guestDeviceName(participant.user.deviceName)}
                local={participant.user.deviceIdentifier === deviceIdentifier}
              />
            ))
          )}
        </div>
      </div>
    </GuestPageFrame>
  );
}

function GuestDeviceRow({ name, local }: { name: string; local: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      <div className="bg-primary size-2.5 rounded-full" />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">
        {name || "Guest"}
        {local ? (
          <span className="text-muted-foreground font-normal"> (You)</span>
        ) : null}
      </p>
      <span className="text-muted-foreground text-xs">In lobby</span>
    </div>
  );
}

function guestDeviceName(deviceName: string): string {
  return deviceName.replace(/^Multiplex Guest ·\s*/, "") || "Guest";
}

function GuestPageFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 px-5 py-10">
      {children}
    </main>
  );
}
