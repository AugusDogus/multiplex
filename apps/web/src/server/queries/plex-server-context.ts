import {
  getServerUrl,
  type HubItem,
  type HubItemWithServer,
  type PlexDevice,
  type PlexServerClient,
  type PlexTvClient,
  type PlexUserInfo,
} from "@multiplex/plex-query";
import { getServersQuery } from "~/server/queries/get-servers";
import { getUserInfoQuery } from "~/server/queries/get-user-info";
import { retryAsync } from "~/server/utils/retry";

export const PMS_REQUEST_RETRY_OPTIONS = {
  attempts: 5,
  baseDelayMs: 1_000,
} as const;

export interface PlexServerContext {
  server: PlexDevice;
  userInfo: PlexUserInfo;
  serverClient: PlexServerClient;
  serverUrl: string | undefined;
  authToken: string;
}

export interface PaginatedHubContent {
  items: HubItemWithServer[];
  totalSize: number;
  offset: number;
  librarySectionTitle?: string;
}

export const EMPTY_PAGINATED_HUB_CONTENT: PaginatedHubContent = {
  items: [],
  totalSize: 0,
  offset: 0,
};

export function buildPlexServerContext(
  plex: PlexTvClient,
  server: PlexDevice,
  userInfo: PlexUserInfo,
): PlexServerContext {
  return {
    server,
    userInfo,
    serverClient: plex.createServerClient(server),
    serverUrl: getServerUrl(server),
    authToken: server.accessToken ?? userInfo.authToken,
  };
}

export async function resolvePlexServerContext(
  plex: PlexTvClient,
  machineIdentifier: string,
): Promise<PlexServerContext | null> {
  const [servers, userInfo] = await Promise.all([
    getServersQuery(plex),
    getUserInfoQuery(plex),
  ]);

  const server = servers.find(
    (entry) => entry.clientIdentifier === machineIdentifier,
  );

  if (!server || !userInfo) {
    return null;
  }

  return buildPlexServerContext(plex, server, userInfo);
}

/**
 * Resolve the server context and run `run` against it, returning `fallback`
 * when the server can't be resolved or any request throws. Centralizes the
 * try/resolve/fallback envelope shared by the library browse queries.
 */
/**
 * Run a PMS request with retries. Successful operations reuse the user-scoped
 * server client; a failed attempt invalidates it before connection discovery
 * starts over.
 */
export async function withPmsRetry<T>(
  plex: PlexTvClient,
  server: PlexDevice,
  userInfo: PlexUserInfo,
  run: (context: PlexServerContext) => Promise<T>,
): Promise<T> {
  let attempt = 0;

  try {
    return await retryAsync(() => {
      if (attempt > 0) {
        plex.invalidateServerClient(server.clientIdentifier);
      }
      attempt += 1;

      const context = buildPlexServerContext(plex, server, userInfo);
      return run(context);
    }, PMS_REQUEST_RETRY_OPTIONS);
  } catch (error) {
    plex.invalidateServerClient(server.clientIdentifier);
    throw error;
  }
}

export async function withPlexServerContext<T>(
  plex: PlexTvClient,
  machineIdentifier: string,
  fallback: T,
  run: (context: PlexServerContext) => Promise<T>,
): Promise<T> {
  try {
    const context = await resolvePlexServerContext(plex, machineIdentifier);
    return context ? await run(context) : fallback;
  } catch {
    return fallback;
  }
}

export function enrichHubItemsWithServer(
  items: HubItem[],
  context: PlexServerContext,
): HubItemWithServer[] {
  return items.map((item) => ({
    ...item,
    serverId: context.server.clientIdentifier,
    serverUrl: context.serverUrl,
    authToken: context.authToken,
    serverName: context.server.name,
  }));
}

export function enrichHubsWithServer<THub extends { items: HubItem[] }>(
  hubs: THub[],
  context: PlexServerContext,
) {
  return hubs.map((hub) => ({
    ...hub,
    serverId: context.server.clientIdentifier,
    items: enrichHubItemsWithServer(hub.items, context),
  }));
}
