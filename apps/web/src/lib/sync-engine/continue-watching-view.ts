import type { ContinueWatchingItemWithServer } from "@multiplex/plex-query";

import { resolveItemCredentials } from "./resolve-connection";
import type { SanitizedContinueWatchingRow } from "./sanitize";

/**
 * Restore the order from `getAllContinueWatching` after TanStack DB yields rows
 * by lexicographic `id`. Prefer `listIndex`; fall back to newest `lastViewedAt`.
 */
export function sortContinueWatchingRows(
  rows: readonly SanitizedContinueWatchingRow[],
): SanitizedContinueWatchingRow[] {
  return [...rows].sort((a, b) => {
    const aIndex = a.listIndex;
    const bIndex = b.listIndex;
    if (aIndex != null && bIndex != null && aIndex !== bIndex) {
      return aIndex - bIndex;
    }
    if (aIndex != null && bIndex == null) return -1;
    if (aIndex == null && bIndex != null) return 1;

    const aTime = a.lastViewedAt ?? 0;
    const bTime = b.lastViewedAt ?? 0;
    if (aTime !== bTime) return bTime - aTime;

    return a.id.localeCompare(b.id);
  });
}

/**
 * Rehydrate a UI/playable Continue Watching item from a durable row
 * (credentials included) with session/server fallbacks.
 */
export function toContinueWatchingItemWithServer(
  row: SanitizedContinueWatchingRow,
): ContinueWatchingItemWithServer {
  const connection = resolveItemCredentials(row.id, row);

  return {
    ratingKey: row.ratingKey,
    key: row.key ?? `/library/metadata/${row.ratingKey}`,
    guid: "",
    type: row.type,
    title: row.title,
    grandparentTitle: row.grandparentTitle ?? undefined,
    parentTitle: row.parentTitle ?? undefined,
    parentRatingKey: row.parentRatingKey ?? undefined,
    grandparentRatingKey: row.grandparentRatingKey ?? undefined,
    parentIndex: row.parentIndex ?? undefined,
    index: row.index ?? undefined,
    thumb: row.thumb ?? undefined,
    art: row.art ?? undefined,
    parentThumb: row.parentThumb ?? undefined,
    grandparentThumb: row.grandparentThumb ?? undefined,
    year: row.year ?? undefined,
    contentRating: row.contentRating ?? undefined,
    viewOffset: row.viewOffset ?? undefined,
    duration: row.duration ?? undefined,
    progressPercent: row.progressPercent ?? undefined,
    isCompleted: row.isCompleted ?? undefined,
    timeRemaining: row.timeRemaining ?? undefined,
    lastViewedAt:
      typeof row.lastViewedAt === "number"
        ? new Date(row.lastViewedAt * 1000)
        : undefined,
    hubTitle: row.hubTitle ?? "",
    hubType: row.hubType ?? "",
    librarySectionTitle: row.librarySectionTitle ?? "",
    librarySectionID: row.librarySectionID ?? 0,
    librarySectionKey: row.librarySectionKey ?? "",
    Media: Array.isArray(row.Media)
      ? (row.Media as ContinueWatchingItemWithServer["Media"])
      : undefined,
    serverId: row.serverId,
    serverName: row.serverName ?? undefined,
    serverUrl: connection.serverUrl,
    authToken: connection.authToken,
  };
}
