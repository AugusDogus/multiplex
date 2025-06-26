import type { PlexTvClient } from "~/lib/plex.tv/client";

export async function getServersQuery(plex: PlexTvClient) {
  const servers = await plex.getServers();
  return servers;
}
