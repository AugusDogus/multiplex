import type { WatchTogetherRoom } from "@multiplex/plex-query";

import type { SanitizedWatchTogetherRoomRow } from "./sanitize";

/**
 * Restore together.plex.tv list order for the home row.
 *
 * The durable collection yields rows in key-sorted id order; `listIndex` is the
 * position from the last `/rooms` response. Rows without an index (single-room
 * warm before a full list sync) fall back to newest `updatedAt`/`startsAt`.
 */
export function sortWatchTogetherRoomRows(
  rows: readonly SanitizedWatchTogetherRoomRow[],
): SanitizedWatchTogetherRoomRow[] {
  return [...rows].sort((a, b) => {
    const aIndex = a.listIndex;
    const bIndex = b.listIndex;
    if (aIndex !== null && bIndex !== null && aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    if (aIndex !== null && bIndex === null) return -1;
    if (aIndex === null && bIndex !== null) return 1;

    const aTime = roomRecencySeconds(a);
    const bTime = roomRecencySeconds(b);
    if (aTime !== bTime) {
      return bTime - aTime;
    }
    return a.id.localeCompare(b.id);
  });
}

function roomRecencySeconds(row: SanitizedWatchTogetherRoomRow): number {
  const timestamp = row.updatedAt ?? row.startsAt;
  if (timestamp === null) return 0;
  // together.plex.tv sometimes sends ms; normalize to seconds for compares.
  return timestamp > 1e12 ? timestamp / 1000 : timestamp;
}

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
