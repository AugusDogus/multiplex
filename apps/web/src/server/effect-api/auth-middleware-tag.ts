/**
 * Auth middleware *tags* for the Plex HttpApi — no server-only imports.
 *
 * Live better-auth resolution lives in `./auth-middleware`. This module is safe
 * to import from isomorphic contract code (`./api`) and the browser AtomHttpApi
 * client (session cookies are sent automatically for same-origin `/api/effect`).
 */
import { Context } from "effect";
import type { PlexTvClient, WatchTogetherClient } from "@multiplex/plex-query";
import { HttpApiMiddleware, HttpApiSecurity } from "effect/unstable/httpapi";

import { UnauthorizedError } from "./errors";

/**
 * Minimal auth-session shape for the HttpApi tag. Intentionally structural and
 * free of better-auth imports so `./api` stays client-safe. The live middleware
 * provides the full better-auth session, which is assignable to this shape.
 */
export type PlexSessionShape = {
  readonly authSession: {
    readonly user: {
      readonly id: string;
      readonly plexAuthToken?: string | null;
    };
    readonly session: {
      readonly id: string;
    };
  };
  readonly plex: PlexTvClient;
  readonly watchTogether: WatchTogetherClient;
};

export class PlexSession extends Context.Service<
  PlexSession,
  PlexSessionShape
>()("multiplex/effect-api/PlexSession") {}

/**
 * Cookie-based better-auth session middleware tag. Declares the session cookie
 * as the security scheme so missing cookies fail closed before the handler.
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
