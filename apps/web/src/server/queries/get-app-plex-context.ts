import {
  PlexTvClient,
  type PlexDevice,
  type PlexUserInfo,
} from "@multiplex/plex-query";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "~/lib/auth/server";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
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
  const [servers, userInfo] = await Promise.all([
    getServersQuery(plex),
    getUserInfoQuery(plex),
  ] as const);

  if (!userInfo) {
    throw new AppPlexBootstrapError();
  }

  return { session, servers, userInfo };
});
