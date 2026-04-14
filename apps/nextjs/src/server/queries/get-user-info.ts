import type { PlexTvClient } from "@multiplex/plex-query";

export async function getUserInfoQuery(plex: PlexTvClient) {
  return await plex.getUserInfo();
}
