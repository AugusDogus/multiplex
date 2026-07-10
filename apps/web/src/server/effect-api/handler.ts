import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import { PlexApi } from "./api";
import { PlexAuthMiddlewareLive } from "./auth-middleware";
import type { PlexAuthMiddleware } from "./auth-middleware";
import { PlexApiHandlers } from "./handlers";

/** Prefixed router view so all PlexApi routes live under `/api/effect`. */
const PrefixedRouterLive = Layer.effect(
  HttpRouter.HttpRouter,
  Effect.map(HttpRouter.HttpRouter.asEffect(), (router) =>
    router.prefixed("/api/effect"),
  ),
);

/**
 * Fully-wired Plex HttpApi layer: routes + handlers + auth middleware.
 * Auth can be swapped for tests via `makePlexApiLive(stubAuth)`.
 */
export const makePlexApiLive = (
  authMiddleware: Layer.Layer<PlexAuthMiddleware> = PlexAuthMiddlewareLive,
) =>
  HttpApiBuilder.layer(PlexApi).pipe(
    Layer.provide(PlexApiHandlers),
    Layer.provide(authMiddleware),
    Layer.provide(PrefixedRouterLive),
  );

/**
 * Build a `(request) => Promise<Response>` web handler.
 *
 * Uses Effect v4 `HttpRouter.toWebHandler` — the same binding executor uses in
 * `toApiHandler` / cloud `handleApiRequest`. `HttpServer.layerServices`
 * supplies the synthetic HTTP platform (no listening socket).
 */
export const makePlexWebHandler = (
  authMiddleware: Layer.Layer<PlexAuthMiddleware> = PlexAuthMiddlewareLive,
) => {
  const appLayer = makePlexApiLive(authMiddleware).pipe(
    Layer.provideMerge(HttpServer.layerServices),
  );
  // Leftover requirements resolve to `never` once platform + auth are provided;
  // the cast matches executor's `toApiHandler` narrowing.
  return HttpRouter.toWebHandler(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- host layer channel erased; runtime is fully provided
    appLayer as Layer.Layer<any, any, any>,
  );
};

/** Module-scope production handler (built once; Next.js route reuses it). */
export const plexWebHandler = makePlexWebHandler();
