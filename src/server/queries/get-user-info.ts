import type { PlexTvClient } from "~/lib/plex.tv/client";

export async function getUserInfoQuery(plex: PlexTvClient) {
  return await plex.getUserInfo();
}
