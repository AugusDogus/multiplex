import {
  PlexAPIError,
  PlexTvClient,
  type PlexDevice,
  type PlexUserInfo,
} from "@multiplex/plex-query";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "~/lib/auth/server";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import { getAllContinueWatchingQuery } from "~/server/queries/get-all-continue-watching";
import { getAllServerLibrariesQuery } from "~/server/queries/get-all-server-libraries";
import { getHomeHubsQuery } from "~/server/queries/get-home-hubs";
import { getServersQuery } from "~/server/queries/get-servers";
import { getUserInfoQuery } from "~/server/queries/get-user-info";

type AppSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

export interface AppPlexContext {
  session: AppSession;
  servers: PlexDevice[];
  userInfo: PlexUserInfo;
}

export class AppPlexBootstrapError extends Error {
  constructor(message = "Failed to load Plex account data.") {
    super(message);
    this.name = "AppPlexBootstrapError";
  }
}

/** Deduped per-request fetch of shell-owned Plex account data. */
export const getAppPlexContext = cache(async (): Promise<AppPlexContext> => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    redirect("/login");
  }

  const token = session.user.plexAuthToken;
  if (!token) {
    redirect("/login");
  }

  const plex = new PlexTvClient(token, NEXTJS_PLEX_CONFIG);
  let servers: PlexDevice[];
  let userInfo: PlexUserInfo | null;
  try {
    [servers, userInfo] = await Promise.all([
      getServersQuery(plex),
      getUserInfoQuery(plex),
    ] as const);
  } catch (error) {
    // Expired/revoked token is an expected failure: re-authenticate instead
    // of surfacing a boundary error the client can't classify (Server
    // Component error messages are redacted in production).
    if (isPlexAuthExpired(error)) redirect("/login");
    throw error;
  }

  if (!userInfo) {
    throw new AppPlexBootstrapError();
  }

  // Overlap PMS discovery + home data fill with the rest of the RSC tree.
  // Parallel Suspense lanes / `"use cache"` create fresh clients; shared
  // connection discovery + these warmed caches keep Continue Watching off the
  // critical path of a second serial round-trip.
  for (const server of servers) {
    if (server.presence === false) continue;
    void plex
      .createServerClient(server)
      .warmConnection()
      .catch(ignoreDetachedWarmFailure);
  }
  void getAllContinueWatchingQuery(plex).catch(ignoreDetachedWarmFailure);
  void getHomeHubsQuery(plex).catch(ignoreDetachedWarmFailure);
  void getAllServerLibrariesQuery(plex).catch(ignoreDetachedWarmFailure);

  return { session, servers, userInfo };
});

function isPlexAuthExpired(cause: unknown): boolean {
  return cause instanceof PlexAPIError && cause.status === 401;
}

/** Fire-and-forget warm paths must not surface as unhandled rejections. */
function ignoreDetachedWarmFailure(): void {
  // Real request paths handle Plex/network failures when data is needed.
}
