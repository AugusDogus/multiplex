"use client";

import { useMemo } from "react";
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
import { Loader2, Play, Users } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  getPlexUserName,
  PlexUserAvatar,
} from "~/components/watch-together/plex-user-avatar";
import { useWatchTogetherLobbyPresence } from "~/components/watch-together/use-watch-together-lobby-presence";
import { useWatchTogetherRoomMedia } from "~/components/watch-together/use-watch-together-room-media";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { getWatchTogetherDeviceIdentifier } from "~/lib/device-identifier";
import { cn } from "~/lib/utils";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { useWatchTogetherStore } from "~/stores/watch-together-store";
import { api } from "~/trpc/react";

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
    { refetchInterval: 10_000 },
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
      deviceIdentifier: getWatchTogetherDeviceIdentifier(),
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
  const canStart = Boolean(
    room &&
      playTarget &&
      details?.serverUrl &&
      details.authToken &&
      userInfoQuery.data,
  );

  const startPlayback = () => {
    if (
      !room ||
      !source ||
      !playTarget ||
      !details?.serverUrl ||
      !details.authToken ||
      !localUser
    ) {
      return;
    }

    setSession({ room, localUser });

    openPlayer(
      createMediaPlayerItem(playTarget, {
        serverId: source.serverId,
        serverUrl: details.serverUrl,
        authToken: details.authToken,
      }),
    );
  };

  const leaveLobby = () => {
    clearSession();
    router.push("/");
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
              {someoneElseWatching
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
                Cancel
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
