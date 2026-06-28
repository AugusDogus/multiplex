"use client";

// Keep the existing key so browsers retain their established identifier.
const PLEX_CLIENT_ID_KEY = "multiplex-watch-together-device-id";

/**
 * A stable, per-browser Plex client identifier (persisted in localStorage).
 *
 * Used both as the Syncplay device identifier and as the `X-Plex-Client-Identifier`
 * on direct media stream requests. Plex keys transcode sessions by client
 * identifier + session, so every browser MUST present a distinct identifier —
 * otherwise two Watch Together viewers streaming the same item collide on one
 * transcode session (the second start kills the first, causing a black screen /
 * "no supported sources").
 */
export function getPlexClientIdentifier(): string {
  const stored = window.localStorage.getItem(PLEX_CLIENT_ID_KEY);
  if (stored) {
    return stored;
  }

  const clientIdentifier = `multiplex-${crypto.randomUUID()}`;
  window.localStorage.setItem(PLEX_CLIENT_ID_KEY, clientIdentifier);
  return clientIdentifier;
}
