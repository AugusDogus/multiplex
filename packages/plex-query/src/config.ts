import type { PlexConfig } from "./plex";

/**
 * Get the stored client identifier or generate a new one
 */
function getClientIdentifier(): string {
  if (typeof window === "undefined") {
    return "server-side";
  }

  const stored = localStorage.getItem("plex-client-id");
  if (stored) {
    return stored;
  }

  const newId = crypto.randomUUID();
  localStorage.setItem("plex-client-id", newId);
  return newId;
}

/**
 * Default Plex client configuration
 */
export const DEFAULT_PLEX_CONFIG: PlexConfig = {
  product: "Multiplex",
  clientIdentifier: getClientIdentifier(),
  version: "1.0.0",
  platform: "Web",
};

/**
 * Get the default config with a fresh client identifier check
 */
export function getPlexConfig(): PlexConfig {
  return {
    ...DEFAULT_PLEX_CONFIG,
    clientIdentifier: getClientIdentifier(),
  };
}
