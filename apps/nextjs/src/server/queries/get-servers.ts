import type { PlexTvClient } from "@multiplex/plex-query";

export async function getServersQuery(plex: PlexTvClient) {
  const servers = await plex.getServers();
  return servers;
}
