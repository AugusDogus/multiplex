import type { HubItemWithServer } from "@multiplex/plex-query";

import { getItemConnection } from "./connection-overlay";
import type { SanitizedBrowsePageRow } from "./sanitize";

export function toHubItemsWithServer(
  row: SanitizedBrowsePageRow,
): HubItemWithServer[] {
  return row.items.map((item) => {
    const connection = getItemConnection(`${item.serverId}:${item.ratingKey}`);
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
      serverId: item.serverId,
      serverUrl: connection?.serverUrl,
      authToken: connection?.authToken,
    };
  });
}
