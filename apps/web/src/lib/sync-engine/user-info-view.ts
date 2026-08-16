import type { PlexUserInfo } from "@multiplex/plex-query";

import type { SanitizedUserInfoRow } from "./sanitize";

/**
 * Rebuild a PlexUserInfo-shaped object for UI. `authToken` is never restored
 * from OPFS — callers that need a token use server session / connection overlay.
 */
export function toPlexUserInfo(row: SanitizedUserInfoRow): PlexUserInfo {
  return {
    ...row.payload,
    id: row.plexUserId,
    uuid: row.uuid ?? "",
    username: row.username ?? "",
    title: row.title ?? "",
    email: row.email ?? "",
    thumb: row.thumb ?? "",
    // Satisfies the schema; never persisted. Client surfaces that need tokens
    // must not read this field from the replica.
    authToken: "",
  };
}
