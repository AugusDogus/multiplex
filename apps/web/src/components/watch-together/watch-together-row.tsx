"use client";

import Image from "next/image";
import Link from "next/link";
import { getMainTitle } from "@multiplex/plex-query";
import { Play, Users } from "lucide-react";

import { MediaCarousel } from "~/components/media-carousel";
import {
  PlexUserAvatarStack,
  type PlexUserLike,
} from "~/components/watch-together/plex-user-avatar";
import { useWatchTogetherRoomMedia } from "~/components/watch-together/use-watch-together-room-media";
import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import type { RouterOutputs } from "~/trpc/react";

type WatchTogetherRoom = RouterOutputs["plex"]["getWatchTogetherRooms"][number];

export function WatchTogetherRow() {
  const { data: rooms = [] } = api.plex.getWatchTogetherRooms.useQuery(
    undefined,
    {
      refetchInterval: 15_000,
      staleTime: 0,
    },
  );

  if (rooms.length === 0) {
    return null;
  }

  return (
    <MediaCarousel
      header={
        <h2 className="text-2xl font-semibold tracking-tight">
          Watch Together
        </h2>
      }
    >
      {rooms.map((room) => (
        <WatchTogetherRoomCard key={room.id} room={room} />
      ))}
    </MediaCarousel>
  );
}

function WatchTogetherRoomCard({ room }: { room: WatchTogetherRoom }) {
  const { item, posterUrl, isPending } = useWatchTogetherRoomMedia(
    room.sourceUri,
  );
  const title = item ? getMainTitle(item) : room.title;

  return (
    <Link
      href={getWatchTogetherRoomHref(room.id)}
      aria-label={`Open Watch Together room for ${title}`}
      className="group flex w-[160px] flex-col gap-2"
    >
      <div className="bg-muted relative aspect-2/3 overflow-hidden rounded-md shadow-lg transition-[transform,box-shadow] duration-200 ease-out group-hover:shadow-xl group-active:scale-[0.98] md:group-active:scale-100">
        {posterUrl ? (
          <Image
            src={posterUrl}
            alt={`${title} poster`}
            fill
            sizes="160px"
            className="object-cover"
          />
        ) : (
          <div
            className={cn(
              "flex size-full items-center justify-center",
              isPending && "animate-pulse",
            )}
          >
            <Play className="text-muted-foreground size-10" />
          </div>
        )}

        <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
          <Users className="size-3" />
          Together
        </span>

        <div className="pointer-events-none absolute inset-0 hidden items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 ease-out group-hover:opacity-100 md:flex">
          <span className="flex size-11 items-center justify-center rounded-full bg-white/95 text-black shadow-lg">
            <Play className="size-5 translate-x-px fill-current" />
          </span>
        </div>

        {room.users.length > 0 && (
          <div className="absolute inset-x-0 bottom-0 flex items-end p-2">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-black/70 to-transparent" />
            <PlexUserAvatarStack
              users={room.users}
              max={4}
              className="relative"
            />
          </div>
        )}
      </div>

      <div className="min-w-0">
        <h3 className="truncate text-sm leading-tight font-medium">{title}</h3>
        <p className="text-muted-foreground truncate text-xs leading-tight">
          {formatParticipants(room.users)}
        </p>
      </div>
    </Link>
  );
}

function formatParticipants(users: PlexUserLike[]) {
  const names = users
    .map((user) => user.title ?? user.username)
    .filter((name): name is string => Boolean(name));

  if (names.length === 0) {
    return "Watch Together session";
  }

  if (names.length === 1) {
    return names[0];
  }

  if (names.length === 2) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names[0]} and ${names.length - 1} others`;
}
