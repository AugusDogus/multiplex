"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  getDetailsSecondaryTitle,
  getMainTitle,
  getMetadataSummaryLines,
  getMetadataTypeLabel,
  type SyncplayParticipantState,
  type SyncplayUser,
} from "@multiplex/plex-query";
import { Loader2, LogOut, Play, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  getPlexUserName,
  PlexUserAvatar,
} from "~/components/watch-together/plex-user-avatar";
import { useWatchTogetherLobbyPresence } from "~/components/watch-together/use-watch-together-lobby-presence";
import { MULTIPLEX_SYNCPLAY_DEVICE_NAME } from "~/components/watch-together/watch-together-auto-advance";
import { WatchTogetherLobbyInviteDialog } from "~/components/watch-together/watch-together-lobby-invite-dialog";
import { useWatchTogetherRoomMedia } from "~/components/watch-together/use-watch-together-room-media";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { getPlexClientIdentifier } from "~/lib/device-identifier";
import { cn } from "~/lib/utils";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { useWatchTogetherStore } from "~/stores/watch-together-store";
import { api } from "~/trpc/react";

// Short settle delay before auto-starting once everyone has joined, so a
// transient presence blip doesn't launch playback prematurely.
const AUTO_START_DELAY_MS = 1200;

// Presence flaps briefly (isPresent false->true) during the Syncplay
// observer->driver handoff when a participant starts watching — their lobby
// socket closes and the player's opens. Treat "everyone joined" as sticky:
// true immediately, false only after sustained absence, so those blips can't
// reset the auto-start timer (which left the second joiner stuck).
const PRESENCE_GRACE_MS = 3000;

interface WatchTogetherLobbyProps {
  roomId: string;
}

export function WatchTogetherLobby({ roomId }: WatchTogetherLobbyProps) {
  const router = useRouter();
  const openPlayer = useMediaPlayerStore((state) => state.openPlayer);
  const setSession = useWatchTogetherStore((state) => state.setSession);
  const clearSession = useWatchTogetherStore((state) => state.clearSession);
  const participants = useWatchTogetherStore((state) => state.participants);
  const session = useWatchTogetherStore((state) => state.session);
  const autoStartSuppressedRoomId = useWatchTogetherStore(
    (state) => state.autoStartSuppressedRoomId,
  );
  // The user deliberately left this room's playback (closed the player), so
  // don't auto-start them straight back in; they can still press Start.
  const autoStartSuppressed = autoStartSuppressedRoomId === roomId;
  const [inviteOpen, setInviteOpen] = useState(false);
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

  // Only the room fields Syncplay needs, kept reference-stable (depend on the
  // primitives, not the room object) so the presence connection isn't torn down
  // on every 10s room refetch / participant-list change.
  const roomSyncplayHost = room?.syncplayHost;
  const roomSyncplayPort = room?.syncplayPort;
  const roomSourceUri = room?.sourceUri;
  const presenceRoom = useMemo(
    () =>
      roomSyncplayHost !== undefined &&
      roomSyncplayPort !== undefined &&
      roomSourceUri !== undefined
        ? {
            id: roomId,
            syncplayHost: roomSyncplayHost,
            syncplayPort: roomSyncplayPort,
            sourceUri: roomSourceUri,
          }
        : undefined,
    [roomId, roomSyncplayHost, roomSyncplayPort, roomSourceUri],
  );

  // Latest room playhead, observed from presence State pings, so a late joiner
  // starts where the room is instead of resetting everyone to 0:00. Until a
  // real State ping arrives the position is unknown — a joiner must wait for it
  // rather than treat the default as 0:00 (which would reset the room). The
  // `known` flag is state (not just a ref) so the Join button and auto-start
  // react once it flips.
  const roomPositionRef = useRef(0);
  const [roomPositionKnown, setRoomPositionKnown] = useState(false);

  // Stable across renders (only touches a ref and a state setter), so the
  // presence connection doesn't tear down and reconnect on every render.
  const handleRoomState = useCallback(
    (state: { paused: boolean; positionSeconds: number }) => {
      roomPositionRef.current = state.positionSeconds;
      setRoomPositionKnown(true);
    },
    [],
  );

  // While in the lobby (and not yet playing) join Syncplay for presence so
  // everyone sees who has actually arrived. The media player takes over the
  // connection once playback starts (session set).
  useWatchTogetherLobbyPresence({
    room: presenceRoom,
    localUser,
    enabled: !session,
    onRoomState: handleRoomState,
  });

  // Syncplay participant state is keyed by device identifier, so index it by
  // the numeric Plex user id once to match it against the room's user list.
  const participantsByUserId = useMemo(
    () =>
      new Map(
        Object.values(participants).map((state) => [state.user.id, state]),
      ),
    [participants],
  );

  const details = media.details;
  const item = media.item;
  const playTarget = details?.playTarget;
  const serverId = source?.serverId;
  const serverUrl = details?.serverUrl;
  const authToken = details?.authToken;
  const canStart = Boolean(
    room && playTarget && serverId && serverUrl && authToken && localUser,
  );
  // You're the only member of the room (everyone else removed themselves, or
  // it was created solo). A one-person Watch Together isn't a watch party —
  // there's nothing to start, only friends to invite — so we don't auto-start
  // or show Start; the lobby's purpose is the Invite button.
  const isSoloRoom = (room?.users.length ?? 0) <= 1;

  // Stable so the auto-start effect's timer isn't reset on every render.
  // Returns whether playback actually opened, so auto-start only latches once it
  // has truly started (and retries if a param wasn't ready yet).
  const startPlayback = useCallback(() => {
    if (
      !room ||
      !serverId ||
      !playTarget ||
      !serverUrl ||
      !authToken ||
      !localUser
    ) {
      return false;
    }

    // Joining a session someone is already watching? Start at the room's
    // current position (observed from presence), so the joiner syncs up instead
    // of dragging everyone back to 0:00. Otherwise (fresh auto-start) everyone
    // begins at the beginning together — not their personal resume point — so
    // they stay in sync from the same spot.
    const joiningInProgress = Object.values(
      useWatchTogetherStore.getState().participants,
    ).some((p) => p.user.id !== localUser.id && p.isReady);
    // Don't join until we actually know where the room is — a default of 0
    // would reset everyone. Bail so auto-start retries (this callback re-runs
    // when `roomPositionKnown` flips) and the Join button stays disabled.
    if (joiningInProgress && !roomPositionKnown) {
      return false;
    }

    setSession({ room, localUser });

    const startPositionSeconds = joiningInProgress
      ? roomPositionRef.current
      : undefined;

    openPlayer(
      createMediaPlayerItem(playTarget, { serverId, serverUrl, authToken }),
      { resume: false, startPositionSeconds },
    );
    return true;
  }, [
    room,
    serverId,
    playTarget,
    serverUrl,
    authToken,
    localUser,
    roomPositionKnown,
    setSession,
    openPlayer,
  ]);

  // Every invited participant is present in the lobby right now (the local user
  // counts as present even before their own presence frame arrives).
  const allInvitedPresentNow = Boolean(
    room &&
      room.users.length > 0 &&
      room.users.every(
        (user) =>
          user.id === localUserId ||
          Boolean(participantsByUserId.get(user.id)?.isPresent),
      ),
  );

  // Sticky/debounced: shields the auto-start (and the hint) from the brief
  // presence blips of the observer->driver handoff.
  const [allInvitedPresent, setAllInvitedPresent] = useState(false);
  useEffect(() => {
    if (allInvitedPresentNow) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- safe debounce: idempotent flip-on; the flip-off below is delayed
      setAllInvitedPresent(true);
      return;
    }
    const timer = setTimeout(
      () => setAllInvitedPresent(false),
      PRESENCE_GRACE_MS,
    );
    return () => clearTimeout(timer);
  }, [allInvitedPresentNow]);

  const utils = api.useUtils();
  // "Leave" removes the session for this viewer (Plex's per-user removal) —
  // going back home is what the sidebar is for, so the button actually leaves.
  const leaveRoom = api.plex.deleteWatchTogetherRoom.useMutation({
    onSuccess: async () => {
      await utils.plex.getWatchTogetherRooms.invalidate();
      clearSession();
      router.push("/");
    },
    onError: () => {
      // Removal failed, but honor the intent to leave rather than trapping the
      // user in the lobby.
      clearSession();
      router.push("/");
      toast.error("Couldn't remove the session, but you've left it.");
    },
  });
  // A leave in flight must win over starting: don't auto-start (or let Start
  // fire) while we're tearing the room down.
  const leaving = leaveRoom.isPending;

  // Auto-start like the official Plex app: once everyone has (stably) joined,
  // open the player automatically. Fires once per "gathering" — re-armed only
  // when everyone genuinely scatters (debounced above), so it neither loops
  // after the player is closed nor gets stuck on a transient blip. Latches only
  // once playback actually opens, so a not-yet-ready moment can retry.
  const hasAutoStartedRef = useRef(false);
  useEffect(() => {
    if (!allInvitedPresent) {
      hasAutoStartedRef.current = false;
      return;
    }
    // Arm only while everyone is present *right now* too (not just per the
    // debounced value): if an invited member leaves during the short auto-start
    // delay, the debounced flag lingers (grace) but `allInvitedPresentNow` flips
    // immediately, so the pending timer is cancelled rather than firing without
    // everyone present.
    if (
      !allInvitedPresentNow ||
      !canStart ||
      session ||
      autoStartSuppressed ||
      isSoloRoom ||
      leaving ||
      hasAutoStartedRef.current
    ) {
      return;
    }

    const timer = setTimeout(() => {
      if (startPlayback()) {
        hasAutoStartedRef.current = true;
      }
    }, AUTO_START_DELAY_MS);

    return () => clearTimeout(timer);
  }, [
    allInvitedPresent,
    allInvitedPresentNow,
    autoStartSuppressed,
    isSoloRoom,
    leaving,
    canStart,
    session,
    startPlayback,
  ]);

  const leaveLobby = () => {
    if (leaving) {
      return;
    }
    leaveRoom.mutate({ roomId });
  };

  if (
    roomQuery.isPending ||
    userInfoQuery.isPending ||
    userInfoQuery.isLoading
  ) {
    return <LobbyStatus message="Loading Watch Together room..." />;
  }

  if (roomQuery.isError || userInfoQuery.isError || !room || !source) {
    return <LobbyStatus message="This Watch Together room is unavailable." />;
  }

  const title = item ? getMainTitle(item) : room.title;
  const secondaryTitle = item ? getDetailsSecondaryTitle(item) : undefined;
  const summaryLines = item ? getMetadataSummaryLines(item) : [];
  const someoneElseWatching = room.users.some(
    (user) =>
      user.id !== localUserId && participantsByUserId.get(user.id)?.isReady,
  );

  const lobbyHint = getLobbyHint({
    everyonePresent: allInvitedPresent,
    everyonePresentNow: allInvitedPresentNow,
    canStart,
    autoStartSuppressed,
    someoneElseWatching,
    isSoloRoom,
  });

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="relative isolate overflow-hidden rounded-2xl border shadow-sm">
        {media.backdropUrl && (
          <Image
            src={media.backdropUrl}
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 1024px, 100vw"
            className="-z-20 object-cover"
          />
        )}
        <div className="from-background via-background/40 absolute inset-0 -z-10 bg-linear-to-t to-transparent" />
        <div className="from-background via-background/80 to-background/30 absolute inset-0 -z-10 bg-linear-to-r" />

        <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-end sm:p-8">
          <div className="bg-muted ring-border relative aspect-2/3 w-28 shrink-0 self-start overflow-hidden rounded-xl shadow-2xl ring-1 sm:w-40">
            {media.posterUrl ? (
              <Image
                src={media.posterUrl}
                alt={`${title} poster`}
                fill
                priority
                sizes="160px"
                className="object-cover"
              />
            ) : (
              <div
                className={cn(
                  "flex size-full items-center justify-center",
                  media.isPending && "animate-pulse",
                )}
              >
                <Play className="text-muted-foreground size-10" />
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Users className="size-4" />
              Watch Together
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
              {secondaryTitle && (
                <p className="text-muted-foreground text-lg">
                  {secondaryTitle}
                </p>
              )}
            </div>
            {item && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {getMetadataTypeLabel(item.type)}
                </Badge>
                {summaryLines.map((line) => (
                  <Badge key={line} variant="outline">
                    {line}
                  </Badge>
                ))}
              </div>
            )}
            <p className="text-muted-foreground text-sm">{lobbyHint}</p>
            {media.isError && (
              <p className="text-destructive text-sm">
                Unable to load this title from the server, so playback may be
                unavailable.
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {/* Plex only lets you invite from the pre-playback lobby; once
                  someone is watching there's nothing to invite into, so hide
                  it and let the user join instead. */}
              {!someoneElseWatching && (
                <Button
                  variant="outline"
                  disabled={leaving}
                  onClick={() => setInviteOpen(true)}
                  aria-label="Invite friends to this session"
                >
                  <UserPlus data-icon="inline-start" />
                  Invite
                </Button>
              )}
              <Button
                variant="outline"
                disabled={leaving}
                aria-busy={leaving || undefined}
                onClick={leaveLobby}
              >
                {leaving ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <LogOut data-icon="inline-start" />
                )}
                Leave
              </Button>
              {/* A one-person room has nothing to start — only friends to
                  invite — so Start appears once there's someone to watch with. */}
              {!isSoloRoom && (
                <Button
                  // A late joiner can't start until we've observed the room's
                  // position, or it would start at 0:00 and reset the room —
                  // treat that brief wait as "preparing" and keep it disabled.
                  disabled={
                    !canStart ||
                    leaving ||
                    (someoneElseWatching && !roomPositionKnown)
                  }
                  aria-busy={
                    media.isPending ||
                    (someoneElseWatching && !roomPositionKnown) ||
                    undefined
                  }
                  onClick={startPlayback}
                >
                  {media.isPending ||
                  (someoneElseWatching && !roomPositionKnown) ? (
                    <Loader2
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  ) : (
                    <Play data-icon="inline-start" />
                  )}
                  {someoneElseWatching ? "Join" : "Start"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">Participants</h2>
          <span className="text-muted-foreground text-sm">
            {room.users.length} invited
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {room.users.map((user) => {
            const participant = participantsByUserId.get(user.id);
            const isLocal = user.id === localUserId;
            const status = getParticipantStatus(participant, isLocal);
            const statusMeta = getStatusMeta(status);

            return (
              <div
                key={user.id}
                className="bg-card flex items-center gap-3 rounded-xl border p-3"
              >
                <div className="relative shrink-0">
                  <PlexUserAvatar user={user} className="size-11" />
                  <span
                    className={cn(
                      "ring-card absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2",
                      statusMeta.dotClassName,
                    )}
                  />
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-1 font-medium">
                    {getPlexUserName(user)}
                    {isLocal && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        (You)
                      </span>
                    )}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {statusMeta.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <WatchTogetherLobbyInviteDialog
        roomId={roomId}
        existingUserIds={room.users.map((user) => user.id)}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
    </section>
  );
}

interface LobbyHintInput {
  /** Everyone invited is present (debounced/sticky). */
  everyonePresent: boolean;
  /** Everyone invited is present right now (undebounced). */
  everyonePresentNow: boolean;
  /** Media has resolved so playback can actually begin. */
  canStart: boolean;
  /** Auto-start is suppressed because this viewer already left the player. */
  autoStartSuppressed: boolean;
  /** Another member has already started watching. */
  someoneElseWatching: boolean;
  /** The local user is the only member of the room. */
  isSoloRoom: boolean;
}

/**
 * The lobby subtitle, kept honest: it must describe what will actually happen.
 * In particular it only promises "starting playback…" when auto-start will
 * really fire — otherwise a suppressed viewer (who closed the player once, or
 * was left alone when the other member ended the session) sat forever under a
 * "starting playback…" that only a page refresh could resolve.
 */
export function getLobbyHint(input: LobbyHintInput): string {
  // A one-person room can't start a watch party; its only action is Invite.
  if (input.isSoloRoom) {
    return "Invite a friend to start watching together.";
  }

  const willAutoStart =
    input.everyonePresent &&
    input.everyonePresentNow &&
    input.canStart &&
    !input.autoStartSuppressed;

  if (willAutoStart) {
    return "Everyone's here — starting playback…";
  }
  // Below here we'd point the user at Start — but it's disabled until the media
  // resolves, so don't tell them to press an unavailable button.
  if (!input.canStart) {
    return input.everyonePresent
      ? "Getting the stream ready…"
      : "Waiting for everyone to join…";
  }
  if (input.someoneElseWatching) {
    return "Someone already started watching — press Join.";
  }
  if (input.autoStartSuppressed && input.everyonePresentNow) {
    return "Press Start when you're ready to watch.";
  }
  if (input.everyonePresent) {
    return "Getting the stream ready…";
  }
  return "Waiting for everyone to join…";
}

type ParticipantStatus = "watching" | "inLobby" | "invited";

function getParticipantStatus(
  participant: SyncplayParticipantState | undefined,
  isLocal: boolean,
): ParticipantStatus {
  // `isReady` is only set once a member's media player is loaded, i.e. they
  // have started watching. Presence (`isPresent`) means they are in the lobby.
  if (participant?.isReady) {
    return "watching";
  }

  if (participant?.isPresent || isLocal) {
    return "inLobby";
  }

  return "invited";
}

function getStatusMeta(status: ParticipantStatus): {
  label: string;
  dotClassName: string;
} {
  switch (status) {
    case "watching":
      return { label: "Watching", dotClassName: "bg-green-500" };
    case "inLobby":
      return { label: "In lobby", dotClassName: "bg-primary" };
    case "invited":
      return { label: "Invited", dotClassName: "bg-muted-foreground/40" };
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function LobbyStatus({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex min-h-64 items-center justify-center rounded-2xl border p-8 text-sm">
      {message}
    </div>
  );
}
