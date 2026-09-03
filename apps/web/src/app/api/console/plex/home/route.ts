import { PlexTvClient } from "@multiplex/plex-query";
import { z } from "zod";

import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";
import { authorizeConsolePlexRequest } from "~/server/console-plex-auth";

const MAX_ROWS = 3;
const MAX_ITEMS = 4;
const serverIdSchema = z.string().min(1).max(128);
const hubItemSchema = z
  .object({
    ratingKey: z.string().regex(/^\d+$/),
    type: z.string(),
    title: z.string(),
    grandparentTitle: z.string().optional(),
    parentTitle: z.string().optional(),
    parentIndex: z.number().optional(),
    index: z.number().optional(),
    year: z.number().optional(),
    duration: z.number().optional(),
    viewOffset: z.number().optional(),
    thumb: z.string().optional(),
    grandparentThumb: z.string().optional(),
  })
  .passthrough();

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, private",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
} as const;

export async function GET(request: Request): Promise<Response> {
  const authorization = await authorizeConsolePlexRequest(request);
  if (authorization.kind === "unauthorized") return unauthorized();
  if (authorization.kind === "plex-not-linked") {
    return Response.json(
      { status: "plex-not-linked" },
      { status: 409, headers: RESPONSE_HEADERS },
    );
  }
  const url = new URL(request.url);
  const parsedServerId = serverIdSchema.safeParse(
    url.searchParams.get("serverId"),
  );
  if (!parsedServerId.success) {
    return Response.json(
      { status: "invalid-request" },
      { status: 400, headers: RESPONSE_HEADERS },
    );
  }

  const plex = new PlexTvClient(
    authorization.plexAuthToken,
    NEXTJS_PLEX_CONFIG,
  );
  const servers = await plex.getServers();
  const server = servers.find(
    (candidate) => candidate.clientIdentifier === parsedServerId.data,
  );
  if (!server) {
    return Response.json(
      { status: "server-not-found" },
      { status: 404, headers: RESPONSE_HEADERS },
    );
  }
  const response = await plex.createServerClient(server).getHubs({
    count: MAX_ITEMS,
    onlyTransient: true,
  });
  const rows = response.hubs
    .filter((hub) => hub.items.length > 0)
    .sort(
      (left, right) =>
        hubPriority(left.hubIdentifier) - hubPriority(right.hubIdentifier),
    )
    .slice(0, MAX_ROWS)
    .flatMap((hub) => {
      const items = hub.items
        .flatMap((item) => {
          const parsed = hubItemSchema.safeParse(item);
          return parsed.success ? [toConsoleItem(parsed.data)] : [];
        })
        .slice(0, MAX_ITEMS);
      return items.length > 0 ? [{ title: hub.title, items }] : [];
    });

  return Response.json(
    {
      apiVersion: 1,
      status: "ready",
      server: { id: server.clientIdentifier, name: server.name },
      rows,
    },
    { headers: RESPONSE_HEADERS },
  );
}

function toConsoleItem(item: z.infer<typeof hubItemSchema>) {
  const isEpisode = item.type === "episode";
  const episode =
    item.parentIndex !== undefined && item.index !== undefined
      ? `S${item.parentIndex.toString().padStart(2, "0")} E${item.index.toString().padStart(2, "0")}`
      : undefined;
  return {
    ratingKey: Number(item.ratingKey),
    mediaType: item.type,
    title: isEpisode ? (item.grandparentTitle ?? item.title) : item.title,
    subtitle: isEpisode
      ? [item.title, episode].filter(Boolean).join(" · ")
      : (item.year?.toString() ?? titleCase(item.type)),
    durationMs: item.duration ?? 0,
    viewOffsetMs: item.viewOffset ?? 0,
    artworkPath: item.grandparentThumb ?? item.thumb ?? null,
  };
}

function hubPriority(identifier: string): number {
  return identifier.includes(".continue") || identifier.includes(".inprogress")
    ? 0
    : identifier.includes("home.ondeck")
      ? 2
      : 1;
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function unauthorized(): Response {
  return Response.json(
    { status: "invalid-credential" },
    { status: 401, headers: RESPONSE_HEADERS },
  );
}
