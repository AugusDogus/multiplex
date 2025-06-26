import type { PlexTvClient } from "~/lib/plex.tv/client";

export async function getUserInfoQuery(plex: PlexTvClient) {
  const userInfo = await plex.getUserInfo();
  return userInfo;
}
