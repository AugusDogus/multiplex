import "server-only";

import {
  enrichMetadataChildren,
  getPlayableChildren,
  getServerUrl,
  PlexTvClient,
  resolvePlayTarget,
} from "@multiplex/plex-query";
import { headers } from "next/headers";
import { cache } from "react";
import { z } from "zod";

import { auth } from "~/lib/auth/server";
import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import { db } from "~/server/db";
import { getServerChannelsProgrammingQuery } from "~/server/queries/get-all-channels-programming";
import { getHubContentQuery } from "~/server/queries/get-hub-content";
import { getLibraryCategoriesQuery } from "~/server/queries/get-library-categories";
import { getLibraryCollectionsQuery } from "~/server/queries/get-library-collections";
import { getLibraryContentQuery } from "~/server/queries/get-library-content";
import { getLibraryMetaQuery } from "~/server/queries/get-library-meta";
import { getLibraryPivotsQuery } from "~/server/queries/get-library-pivots";
import { getLibraryPlaylistsQuery } from "~/server/queries/get-library-playlists";
import {
  HUB_PAGE_SIZE,
  LIBRARY_PAGE_SIZE,
} from "~/server/queries/plex-pagination";
import { getServersQuery } from "~/server/queries/get-servers";

/**
 * Direct server-side Plex data access for React Server Components.
 * RSC helpers for browse surfaces — call `~/server/queries/*` directly.
 *
 * Prefetch-only procedures (home hubs, continue watching, library hubs,
 * watch-together room) stay on client atoms — pages do not await them for
 * props today. `getItemDetails` is included for optional RSC initial data.
 */

// ---------------------------------------------------------------------------
// Context (mirrors createTRPCContext + protectedProcedure auth)
// ---------------------------------------------------------------------------

export class PlexRscUnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED" as const;

  constructor(
    message = "Plex authentication required. Please sign in with Plex again.",
  ) {
    super(message);
    this.name = "PlexRscUnauthorizedError";
  }
}

const createPlexRscContext = cache(async () => {
  const heads = await headers();
  const authSession = await auth.api.getSession({ headers: heads });
  const token = authSession?.user?.plexAuthToken;
  const plex = token ? new PlexTvClient(token, NEXTJS_PLEX_CONFIG) : null;

  return {
    db,
    authSession,
    plex,
    headers: heads,
  };
});

const requirePlex = async () => {
  const ctx = await createPlexRscContext();
  if (!ctx.authSession || !ctx.plex) {
    throw new PlexRscUnauthorizedError();
  }
  return {
    authSession: ctx.authSession,
    plex: ctx.plex,
    db: ctx.db,
  };
};

// ---------------------------------------------------------------------------
// Input validators (mirror Effect HttpApi / plex-query zod schemas)
// ---------------------------------------------------------------------------

const sectionIdSchema = z.string().regex(/^\d+$/);

const librarySectionInput = z.object({
  machineIdentifier: z.string(),
  sectionId: sectionIdSchema,
});

const libraryPageInput = z.object({
  machineIdentifier: z.string(),
  sectionId: sectionIdSchema,
  start: z.number().int().min(0).default(0),
  size: z
    .number()
    .int()
    .min(1)
    .max(LIBRARY_PAGE_SIZE)
    .default(LIBRARY_PAGE_SIZE),
});

const libraryMetaInput = z.object({
  machineIdentifier: z.string(),
  sectionId: sectionIdSchema,
  type: z.string().optional(),
});

const libraryCategoriesInput = z.object({
  machineIdentifier: z.string(),
  sectionId: sectionIdSchema,
  start: z.number().int().min(0).default(0),
  size: z.number().int().min(1).max(500).default(200),
});

const hubContentInput = z.object({
  machineIdentifier: z.string(),
  hubKey: z.string().min(1),
  start: z.number().int().min(0).default(0),
  size: z.number().int().min(1).max(HUB_PAGE_SIZE).default(HUB_PAGE_SIZE),
});

const libraryContentInput = z.object({
  machineIdentifier: z.string(),
  sectionId: sectionIdSchema,
  start: z.number().int().min(0).default(0),
  size: z
    .number()
    .int()
    .min(1)
    .max(LIBRARY_PAGE_SIZE)
    .default(LIBRARY_PAGE_SIZE),
  sort: z.string().default("addedAt:desc"),
  type: z.string().optional(),
  filters: z.record(z.string(), z.string()).optional(),
});

const serverChannelsProgrammingInput = z.object({
  machineIdentifier: z.string(),
  providerIdentifier: z.string(),
  date: z.string().date(),
  startTime: z.date().optional(),
  endTime: z.date().optional(),
});

const serverItemInput = z.object({
  serverId: z.string(),
  ratingKey: z.string(),
});

// ---------------------------------------------------------------------------
// Typed helpers — pages that `await` these today
// ---------------------------------------------------------------------------

export async function getLibraryPivots(
  input: z.input<typeof librarySectionInput>,
) {
  const { plex } = await requirePlex();
  const parsed = librarySectionInput.parse(input);
  return getLibraryPivotsQuery(
    plex,
    parsed.machineIdentifier,
    parsed.sectionId,
  );
}

export async function getLibraryCollections(
  input: z.input<typeof libraryPageInput>,
) {
  const { plex } = await requirePlex();
  const parsed = libraryPageInput.parse(input);
  return getLibraryCollectionsQuery(
    plex,
    parsed.machineIdentifier,
    parsed.sectionId,
    { start: parsed.start, size: parsed.size },
  );
}

export async function getLibraryPlaylists(
  input: z.input<typeof libraryPageInput>,
) {
  const { plex } = await requirePlex();
  const parsed = libraryPageInput.parse(input);
  return getLibraryPlaylistsQuery(
    plex,
    parsed.machineIdentifier,
    parsed.sectionId,
    { start: parsed.start, size: parsed.size },
  );
}

export async function getLibraryCategories(
  input: z.input<typeof libraryCategoriesInput>,
) {
  const { plex } = await requirePlex();
  const parsed = libraryCategoriesInput.parse(input);
  return getLibraryCategoriesQuery(
    plex,
    parsed.machineIdentifier,
    parsed.sectionId,
    { start: parsed.start, size: parsed.size },
  );
}

export async function getLibraryMeta(input: z.input<typeof libraryMetaInput>) {
  const { plex } = await requirePlex();
  const parsed = libraryMetaInput.parse(input);
  return getLibraryMetaQuery(
    plex,
    parsed.machineIdentifier,
    parsed.sectionId,
    parsed.type,
  );
}

export async function getLibraryContent(
  input: z.input<typeof libraryContentInput>,
) {
  const { plex } = await requirePlex();
  const parsed = libraryContentInput.parse(input);
  return getLibraryContentQuery(
    plex,
    parsed.machineIdentifier,
    parsed.sectionId,
    {
      start: parsed.start,
      size: parsed.size,
      sort: parsed.sort,
      type: parsed.type,
      filters: parsed.filters,
    },
  );
}

export async function getHubContent(input: z.input<typeof hubContentInput>) {
  const { plex } = await requirePlex();
  const parsed = hubContentInput.parse(input);
  return getHubContentQuery(plex, parsed.machineIdentifier, parsed.hubKey, {
    start: parsed.start,
    size: parsed.size,
  });
}

export async function getServerChannelsProgramming(
  input: z.input<typeof serverChannelsProgrammingInput>,
) {
  const { plex } = await requirePlex();
  const parsed = serverChannelsProgrammingInput.parse(input);
  return getServerChannelsProgrammingQuery(
    plex,
    parsed.machineIdentifier,
    parsed.providerIdentifier,
    parsed.date,
    parsed.startTime,
    parsed.endTime,
  );
}

/**
 * Optional RSC helper for item details. The details route only *prefetches*
 * today (client atom owns the read); included so surface agents can await
 * server-side if they choose to pass initial data as props.
 */
export async function getItemDetails(input: z.input<typeof serverItemInput>) {
  const { plex, authSession } = await requirePlex();
  const parsed = serverItemInput.parse(input);
  const servers = await getServersQuery(plex);
  const server = servers.find((s) => s.clientIdentifier === parsed.serverId);

  if (!server) {
    throw new Error(`Server with ID ${parsed.serverId} not found`);
  }

  const serverClient = plex.createServerClient(server);
  const item = await serverClient.getItemMetadata(parsed.ratingKey);

  if (!item) {
    return null;
  }

  const children =
    item.type === "show" || item.type === "season"
      ? enrichMetadataChildren(
          await serverClient.getMetadataChildren(parsed.ratingKey),
          item,
        )
      : [];
  const playableChildren = getPlayableChildren(children);

  return {
    item,
    children,
    playableChildren,
    playTarget: resolvePlayTarget(item, playableChildren),
    serverName: server.name,
    serverUrl: getServerUrl(server),
    authToken: server.accessToken ?? authSession.user.plexAuthToken,
  };
}
