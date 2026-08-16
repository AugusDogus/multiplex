import type { ItemMetadata } from "@multiplex/plex-query";

import type { RouterOutputs } from "~/trpc/api";
import { resolveItemCredentials } from "./resolve-connection";
import type { SanitizedMediaItemRow } from "./sanitize";

type ItemDetails = NonNullable<RouterOutputs["plex"]["getItemDetails"]>;

/**
 * Rehydrate a full item-details payload for UI/playback from a durable row
 * (credentials included) with session/server fallbacks.
 */
export function toItemDetails(row: SanitizedMediaItemRow): ItemDetails | null {
  const connection = resolveItemCredentials(row.id, row);
  return {
    item: row.item,
    children: row.children,
    playableChildren: row.playableChildren,
    playTarget: row.playTarget,
    serverName: row.serverName ?? "",
    serverUrl: connection.serverUrl,
    authToken: connection.authToken ?? "",
  };
}

export function toItemMetadata(
  row: SanitizedMediaItemRow,
): ItemMetadata | null {
  return row.item;
}
