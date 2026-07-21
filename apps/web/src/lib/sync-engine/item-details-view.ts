import type { ItemMetadata } from "@multiplex/plex-query";

import type { RouterOutputs } from "~/trpc/api";
import { getItemConnection } from "./connection-overlay";
import type { SanitizedMediaItemRow } from "./sanitize";

type ItemDetails = NonNullable<RouterOutputs["plex"]["getItemDetails"]>;

/**
 * Rehydrate a full item-details payload for UI/playback from a durable row +
 * session connection overlay.
 */
export function toItemDetails(row: SanitizedMediaItemRow): ItemDetails | null {
  if (!row.item || typeof row.item !== "object") {
    return null;
  }

  const connection = getItemConnection(row.id);
  return {
    item: row.item as ItemDetails["item"],
    children: (row.children ?? []) as ItemDetails["children"],
    playableChildren: (row.playableChildren ??
      []) as ItemDetails["playableChildren"],
    playTarget: (row.playTarget ?? null) as ItemDetails["playTarget"],
    serverName: row.serverName ?? "",
    serverUrl: connection?.serverUrl,
    authToken: connection?.authToken ?? "",
  };
}

export function toItemMetadata(
  row: SanitizedMediaItemRow,
): ItemMetadata | null {
  if (!row.item || typeof row.item !== "object") {
    return null;
  }
  return row.item as ItemMetadata;
}
