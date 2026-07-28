import type { PlexConfig } from "@multiplex/plex-query";
import { PLEX_AUTH_CLIENT_IDENTIFIER } from "@multiplex/auth-plugin-plex/server";

export const NEXTJS_PLEX_CONFIG: PlexConfig = {
  product: "Multiplex",
  clientIdentifier: PLEX_AUTH_CLIENT_IDENTIFIER,
  version: "1.0.0",
  platform: "Web",
};
