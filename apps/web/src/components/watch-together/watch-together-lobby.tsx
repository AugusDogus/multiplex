"use client";

import { useRouter } from "next/navigation";
import { Loader2, Play, Users } from "lucide-react";

import { Button } from "~/components/ui/button";
import { createMediaPlayerItem } from "~/lib/create-media-player-item";
import { getWatchTogetherDeviceIdentifier } from "~/lib/device-identifier";
import { parseWatchTogetherSourceUri } from "~/lib/watch-together-source";
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
  const roomQuery = api.plex.getWatchTogetherRoom.useQuery(
    { roomId },
    { refetchInterval: 10_000 },
  );
  const userInfoQuery = api.plex.getUserInfo.useQuery(undefined, {
    staleTime: 60_000,
  });
  const room = roomQuery.data;
  const source = room ? parseWatchTogetherSourceUri(room.sourceUri) : null;
  const detailsQuery = api.plex.getItemDetails.useQuery(
    {
      serverId: source?.serverId ?? "",
      ratingKey: source?.ratingKey ?? "",
    },
    {
      enabled: Boolean(source),
      staleTime: 60_000,
    },
  );

  const details = detailsQuery.data;
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
      !playTarget ||
      !details?.serverUrl ||
      !details.authToken ||
      !userInfoQuery.data
    ) {
      return;
    }

    setSession({
      room,
      localUser: {
        id: userInfoQuery.data.id,
        deviceIdentifier: getWatchTogetherDeviceIdentifier(),
        deviceName: "Multiplex Web",
      },
    });

    openPlayer(
      createMediaPlayerItem(playTarget, {
        serverId: source?.serverId ?? "",
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

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="rounded-2xl border p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
              <Users className="size-4" />
              Watch Together
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {room.title}
            </h1>
            <p className="text-muted-foreground text-sm">
              Playback will stay in sync for everyone in this room.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={leaveLobby}>
              Cancel
            </Button>
            <Button disabled={!canStart} onClick={startPlayback}>
              {detailsQuery.isPending ? (
                <Loader2 className="animate-spin" data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              Start
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border p-6">
        <h2 className="mb-4 text-xl font-semibold">Participants</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {room.users.map((user) => {
            const participant =
              participants[String(user.id)] ??
              Object.values(participants).find(
                (state) => state.user.id === user.id,
              );
            const isLocal = user.id === userInfoQuery.data?.id;
            const status = participant?.isReady
              ? "Ready"
              : participant?.isPresent
                ? "Buffering..."
                : isLocal
                  ? "In lobby"
                  : "Invited";

            return (
              <div
                key={user.id}
                className="bg-card flex items-center gap-3 rounded-xl border p-3"
              >
                <div className="bg-muted flex size-11 items-center justify-center rounded-full">
                  <Users className="text-muted-foreground size-5" />
                </div>
                <div className="min-w-0">
                  <p className="line-clamp-1 font-medium">
                    {user.title ?? user.username ?? "Plex user"}
                  </p>
                  <p className="text-muted-foreground text-sm">{status}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function LobbyStatus({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex min-h-64 items-center justify-center rounded-2xl border p-8 text-sm">
      {message}
    </div>
  );
}
