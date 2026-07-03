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
import { Loader2, Play, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  getPlexUserName,
  PlexUserAvatar,
} from "~/components/watch-together/plex-user-avatar";
import { useWatchTogetherLobbyPresence } from "~/components/watch-together/use-watch-together-lobby-presence";
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
      deviceName: "Multiplex Web",
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

  // While in the lobby (and not yet playing) join Syncplay for presence so
  // everyone sees who has actually arrived. The media player takes over the
  // connection once playback starts (session set).
  useWatchTogetherLobbyPresence({
    room: presenceRoom,
    localUser,
    enabled: !session,
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

    setSession({ room, localUser });

    // Start every participant at the beginning, not their personal resume point
    // (`resume: false` also skips the cached-progress lookup): a Watch Together
    // session must start everyone at the same position so they stay in sync,
    // otherwise each viewer resumes to a different spot and the clients fight to
    // seek each other to their own position. Syncplay keeps everyone together.
    openPlayer(
      createMediaPlayerItem(playTarget, { serverId, serverUrl, authToken }),
      { resume: false },
    );
    return true;
  }, [
    room,
    serverId,
    playTarget,
    serverUrl,
    authToken,
    localUser,
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
    canStart,
    session,
    startPlayback,
  ]);

  const utils = api.useUtils();
  const deleteRoom = api.plex.deleteWatchTogetherRoom.useMutation({
    onSuccess: async () => {
      await utils.plex.getWatchTogetherRooms.invalidate();
      toast("Watch Together session ended");
      clearSession();
      router.push("/");
    },
    onError: () => {
      toast.error("Couldn't end the Watch Together session");
    },
  });

  const leaveLobby = () => {
    clearSession();
    router.push("/");
  };

  const endSession = () => {
    deleteRoom.mutate({ roomId });
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
            <p className="text-muted-foreground text-sm">
              {allInvitedPresent
                ? "Everyone has joined — starting playback..."
                : someoneElseWatching
                  ? "Someone already started watching — press Start to join."
                  : "Playback stays in sync for everyone in this room."}
            </p>
            {media.isError && (
              <p className="text-destructive text-sm">
                Unable to load this title from the server, so playback may be
                unavailable.
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" onClick={leaveLobby}>
                Leave
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={deleteRoom.isPending}
                aria-busy={deleteRoom.isPending || undefined}
                onClick={endSession}
              >
                {deleteRoom.isPending ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Trash2 data-icon="inline-start" />
                )}
                End session
              </Button>
              <Button
                disabled={!canStart}
                aria-busy={media.isPending || undefined}
                onClick={startPlayback}
              >
                {media.isPending ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <Play data-icon="inline-start" />
                )}
                Start
              </Button>
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
    </section>
  );
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
