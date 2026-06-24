"use client";

import Link from "next/link";
import { Users } from "lucide-react";

import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";
import { api } from "~/trpc/react";

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
    <section className="flex flex-col gap-4">
      <h2 className="px-4 text-2xl font-semibold tracking-tight md:px-8">
        Watch Together
      </h2>
      <div className="flex gap-4 overflow-x-auto px-4 pb-2 md:px-8">
        {rooms.map((room) => (
          <Link
            key={room.id}
            href={getWatchTogetherRoomHref(room.id)}
            className="bg-card hover:bg-accent/50 focus-visible:ring-ring flex w-72 shrink-0 flex-col gap-3 rounded-xl border p-4 text-left shadow-sm transition-colors outline-none focus-visible:ring-2"
          >
            <div className="bg-muted flex size-12 items-center justify-center rounded-full">
              <Users className="text-muted-foreground size-6" />
            </div>
            <div className="min-w-0">
              <p className="line-clamp-1 font-medium">{room.title}</p>
              <p className="text-muted-foreground line-clamp-1 text-sm">
                {formatParticipants(room.users)}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function formatParticipants(
  users: { title?: string | null; username?: string | null }[],
) {
  const names = users
    .map((user) => user.title || user.username)
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
