"use client";

import { useState } from "react";
import Image from "next/image";
import {
  getDetailsSecondaryTitle,
  getMainTitle,
  getMetadataSummaryLines,
  getMetadataTypeLabel,
  type ParticipantStatus,
} from "@multiplex/plex-query";
import { Loader2, LogOut, Play, UserPlus, Users } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  getPlexUserName,
  PlexUserAvatar,
} from "~/components/watch-together/plex-user-avatar";
import { WatchTogetherLobbyInviteDialog } from "~/components/watch-together/watch-together-lobby-invite-dialog";
import { useWatchTogetherLobby } from "~/components/watch-together/use-watch-together-lobby";
import { cn } from "~/lib/utils";

interface WatchTogetherLobbyProps {
  roomId: string;
}

export function WatchTogetherLobby({ roomId }: WatchTogetherLobbyProps) {
  const lobby = useWatchTogetherLobby(roomId);
  const [inviteOpen, setInviteOpen] = useState(false);

  if (lobby.status === "loading") {
    return <LobbyStatus message="Loading Watch Together room..." />;
  }

  if (lobby.status === "unavailable") {
    return <LobbyStatus message="This Watch Together room is unavailable." />;
  }

  const {
    room,
    localUserId,
    media,
    participantsByUserId,
    canStart,
    isSoloRoom,
    someoneElseWatching,
    roomPositionKnown,
    leaving,
    lobbyHint,
    startPlayback,
    leaveLobby,
    getParticipantStatus,
  } = lobby;

  const item = media.item;
  const title = item ? getMainTitle(item) : room.title;
  const secondaryTitle = item ? getDetailsSecondaryTitle(item) : undefined;
  const summaryLines = item ? getMetadataSummaryLines(item) : [];

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
