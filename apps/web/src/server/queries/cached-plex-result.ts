import { PlexAPIError } from "@multiplex/plex-query";

/**
 * Serializable outcome of a Plex call made inside a `"use cache"` function.
 *
 * `"use cache"` results cross a React Flight boundary. A `PlexAPIError` thrown
 * inside the cached function reaches the caller as a plain `Error` (dev) or a
 * redacted digest error (prod), so `instanceof` and `status` checks on the
 * caller's side never match. Failures the caller must classify (an expired or
 * revoked token) therefore travel across the boundary as data and are re-raised
 * as a typed error by `unwrap` on the caller's side.
 *
 * The `auth-expired` marker is cached like any other value. That is safe: the
 * token is part of the cache key, and a token plex.tv rejects with 401 does not
 * become valid again; re-authenticating issues a new token and a new key.
 */
export type CachedPlexResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | { readonly kind: "auth-expired" };

const PLEX_AUTH_EXPIRED_MESSAGE =
  "Plex authentication failed. Your token may have expired or been revoked. Please sign in again.";

export function isPlexAuthExpired(cause: unknown): boolean {
  return cause instanceof PlexAPIError && cause.status === 401;
}

export const CachedPlexResult = {
  /** Call inside `"use cache"`: encodes auth expiry as data, rethrows the rest. */
  async capture<T>(run: () => Promise<T>): Promise<CachedPlexResult<T>> {
    try {
      return { kind: "ok", value: await run() };
    } catch (cause) {
      if (isPlexAuthExpired(cause)) return { kind: "auth-expired" };
      throw cause;
    }
  },
  /** Call outside `"use cache"`: re-raises auth expiry as a real `PlexAPIError`. */
  unwrap<T>(result: CachedPlexResult<T>): T {
    if (result.kind === "auth-expired") {
      throw new PlexAPIError(PLEX_AUTH_EXPIRED_MESSAGE, 401);
    }
    return result.value;
  },
} as const;
