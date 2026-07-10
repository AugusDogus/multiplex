/**
 * Live better-auth session middleware for the Plex HttpApi.
 *
 * Tag definitions (isomorphic; client-safe) live in `./auth-middleware-tag`.
 * This module imports `~/lib/auth/server` and must stay server-only.
 */
import {
  getPlexConfig,
  PlexTvClient,
  WatchTogetherClient,
  type PlexDevice,
} from "@multiplex/plex-query";
import { Effect, Layer, type Redacted } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

import { auth } from "~/lib/auth/server";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import {
  PlexAuthMiddleware,
  PlexSession,
  type PlexSessionShape,
} from "./auth-middleware-tag";
import { UnauthorizedError } from "./errors";

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

export type { PlexSessionShape };
export { PlexAuthMiddleware, PlexSession };

export const makePlexSession = (
  authSession: AuthSession,
  plex: PlexTvClient,
): PlexSessionShape => ({
  authSession,
  plex,
  watchTogether: new WatchTogetherClient(plex.getToken(), getPlexConfig()),
});

/**
 * Resolves better-auth session + PlexTvClient from request headers.
 */
export const resolvePlexSessionFromHeaders = (
  headers: Headers,
): Effect.Effect<PlexSessionShape, UnauthorizedError> =>
  Effect.gen(function* () {
    const authSession = yield* Effect.tryPromise({
      try: () => auth.api.getSession({ headers }),
      catch: () =>
        new UnauthorizedError({
          message: "Failed to resolve authentication session",
        }),
    });

    if (!authSession) {
      return yield* new UnauthorizedError({});
    }

    const token = authSession.user.plexAuthToken;
    if (!token) {
      return yield* new UnauthorizedError({
        message:
          "Plex authentication required. Please sign in with Plex again.",
      });
    }

    const plex = new PlexTvClient(token, NEXTJS_PLEX_CONFIG);
    return makePlexSession(authSession, plex);
  });

/**
 * Cookie-based better-auth session middleware. Declares the better-auth
 * session cookie as the security scheme so missing cookies fail closed before
 * the handler; the live impl still calls `auth.api.getSession` with the full
 * request headers, because cookie-cache / dual cookies may be involved.
 */
export const PlexAuthMiddlewareLive = Layer.succeed(PlexAuthMiddleware, {
  cookie: (httpEffect, _options) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
        Effect.mapError(
          () =>
            new UnauthorizedError({
              message: "Failed to read authentication request",
            }),
        ),
      );
      const session = yield* resolvePlexSessionFromHeaders(webRequest.headers);
      return yield* Effect.provideService(httpEffect, PlexSession, session);
    }),
});

/** Test helper: always provides a fixed session (ignores the cookie value). */
export const makeStubPlexAuthMiddlewareLive = (
  session: PlexSessionShape,
): Layer.Layer<PlexAuthMiddleware> =>
  Layer.succeed(PlexAuthMiddleware, {
    cookie: (httpEffect, _options: { credential: Redacted.Redacted }) =>
      Effect.provideService(httpEffect, PlexSession, session),
  });

/** Shared helper: find a server by clientIdentifier or fail with NotFound. */
export const findServer = (
  servers: ReadonlyArray<PlexDevice>,
  serverId: string,
): PlexDevice | undefined =>
  servers.find((s) => s.clientIdentifier === serverId);
