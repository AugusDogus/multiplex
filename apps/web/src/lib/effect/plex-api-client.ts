"use client";

import * as AtomHttpApi from "effect/unstable/reactivity/AtomHttpApi";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { Layer } from "effect";

import { PlexApi } from "~/server/effect-api/api";

/**
 * Same-origin `/api/effect` base. Cookie auth is sent automatically when
 * `credentials: "include"` is set on the Fetch layer (browser same-origin).
 */
export const PLEX_API_BASE_URL = "/api/effect";

const credentialsLayer = Layer.succeed(FetchHttpClient.RequestInit, {
  credentials: "include",
});

/** Fetch HttpClient with credentials for same-origin cookie sessions. */
export const plexHttpClientLayer: Layer.Layer<HttpClient.HttpClient> =
  Layer.merge(FetchHttpClient.layer, credentialsLayer);

const prependEffectApiUrl = HttpClient.mapRequest((request) =>
  HttpClientRequest.prependUrl(request, PLEX_API_BASE_URL),
);

/**
 * AtomHttpApi service for browser query/mutation atoms over `PlexApi`.
 *
 * The contract (`~/server/effect-api/api`) is isomorphic schema code; auth
 * tags live in `auth-middleware-tag` so this import does not pull better-auth
 * or Node-only modules into the client bundle.
 */
export const PlexApiClient = AtomHttpApi.Service<"PlexApiClient">()(
  "PlexApiClient",
  {
    api: PlexApi,
    httpClient: plexHttpClientLayer,
    transformClient: prependEffectApiUrl,
  },
);

export type PlexHttpApiClient = HttpApiClient.ForApi<typeof PlexApi>;

/**
 * Build a plain `HttpApiClient` Effect for imperative call sites (session
 * service, timeline fire-and-forget). Requires `HttpClient` in context.
 */
export const makePlexHttpApiClient = (options?: {
  readonly baseUrl?: string | URL;
}) =>
  HttpApiClient.make(PlexApi, {
    transformClient: options?.baseUrl ? undefined : prependEffectApiUrl,
    baseUrl: options?.baseUrl,
  });
