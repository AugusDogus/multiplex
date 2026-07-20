import type { HubItemWithServer, HubWithServer } from "@multiplex/plex-query";

import { getItemConnection } from "./connection-overlay";
import type { SanitizedHomeHubRow } from "./sanitize";

export function toHubWithServer(row: SanitizedHomeHubRow): HubWithServer {
  const items: HubItemWithServer[] = row.items.map((item) => {
    const connection = getItemConnection(`${row.serverId}:${item.ratingKey}`);
    return {
      ratingKey: item.ratingKey,
      key: item.key ?? `/library/metadata/${item.ratingKey}`,
      type: item.type,
      title: item.title,
      thumb: item.thumb ?? undefined,
      parentThumb: item.parentThumb ?? undefined,
      grandparentThumb: item.grandparentThumb ?? undefined,
      year: item.year ?? undefined,
      parentTitle: item.parentTitle ?? undefined,
      grandparentTitle: item.grandparentTitle ?? undefined,
      parentIndex: item.parentIndex ?? undefined,
      index: item.index ?? undefined,
      childCount: item.childCount ?? undefined,
      leafCount: item.leafCount ?? undefined,
      subtype: item.subtype ?? undefined,
      playlistType: item.playlistType ?? undefined,
      composite: item.composite ?? undefined,
      serverId: row.serverId,
      serverUrl: connection?.serverUrl,
      authToken: connection?.authToken,
    };
  });

  return {
    key: row.hubKey,
    title: row.title,
    type: row.type ?? "mixed",
    hubIdentifier: row.hubIdentifier ?? row.hubKey,
    size: row.size,
    more: row.more ?? undefined,
    items,
    serverId: row.serverId,
  };
}
