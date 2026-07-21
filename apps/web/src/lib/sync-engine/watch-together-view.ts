import type { WatchTogetherRoom } from "@multiplex/plex-query";

import type { SanitizedWatchTogetherRoomRow } from "./sanitize";

export function toWatchTogetherRoom(
  row: SanitizedWatchTogetherRoomRow,
): WatchTogetherRoom {
  return {
    id: row.id,
    sourceUri: row.sourceUri,
    source: typeof row.source === "string" ? row.source : undefined,
    title: row.title,
    type: row.type ?? "watching",
    startsAt: row.startsAt ?? undefined,
    endsAt: row.endsAt ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
    syncplayHost: row.syncplayHost ?? "",
    syncplayPort: row.syncplayPort ?? 0,
    users: row.users.map((user) => ({
      id: user.id,
      title: user.title ?? undefined,
      username: user.username ?? undefined,
      thumb: user.thumb ?? undefined,
    })),
  };
}
