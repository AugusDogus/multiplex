import {
  getPlexConfig,
  PlexTvClient,
  WatchTogetherClient,
  type PlexDevice,
} from "@multiplex/plex-query";
import { Context, Effect, Layer, type Redacted } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi";

import { auth } from "~/lib/auth/server";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import { UnauthorizedError } from "./errors";

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

/**
 * Authenticated request context for HttpApi handlers — same payload the tRPC
 * `protectedProcedure` middleware guarantees (`authSession` + `plex`).
 */
export type PlexSessionShape = {
  readonly authSession: AuthSession;
  readonly plex: PlexTvClient;
  readonly watchTogether: WatchTogetherClient;
};

export class PlexSession extends Context.Service<
  PlexSession,
  PlexSessionShape
>()("multiplex/effect-api/PlexSession") {}

export const makePlexSession = (
  authSession: AuthSession,
  plex: PlexTvClient,
): PlexSessionShape => ({
  authSession,
  plex,
  watchTogether: new WatchTogetherClient(plex.getToken(), getPlexConfig()),
});

/**
 * Resolves better-auth session + PlexTvClient from request headers — same
 * logic as `createTRPCContext` + `enforceUserIsAuthed`.
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
 * request headers (matching tRPC), because cookie-cache / dual cookies may be
 * involved.
 */
export class PlexAuthMiddleware extends HttpApiMiddleware.Service<
  PlexAuthMiddleware,
  { provides: PlexSession }
>()("multiplex/effect-api/PlexAuthMiddleware", {
  error: UnauthorizedError,
  security: {
    cookie: HttpApiSecurity.apiKey({
      in: "cookie",
      key: "better-auth.session_token",
    }),
  },
}) {}

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
