"use client";

import { WatchTogetherLobbyContent } from "~/components/watch-together/watch-together-lobby-content";
import { useWatchTogetherLobby } from "~/components/watch-together/use-watch-together-lobby";

interface WatchTogetherLobbyProps {
  roomId: string;
}

export function WatchTogetherLobby({ roomId }: WatchTogetherLobbyProps) {
  const lobby = useWatchTogetherLobby(roomId);

  if (lobby.status === "loading") {
    return <LobbyStatus message="Loading Watch Together room..." />;
  }

  if (lobby.status === "unavailable") {
    return <LobbyStatus message="This Watch Together room is unavailable." />;
  }

  return <WatchTogetherLobbyContent lobby={lobby} roomId={roomId} />;
}

function LobbyStatus({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex min-h-64 items-center justify-center rounded-2xl border p-8 text-sm">
      {message}
    </div>
  );
}
