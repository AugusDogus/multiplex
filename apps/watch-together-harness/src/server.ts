import {
  PlexTvClient,
  WatchTogetherClient,
  type PlexConfig,
  type PlexDevice,
  type PlexServerClient,
} from "@multiplex/plex-query";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  harnessBootstrapSchema,
  harnessNextRoomSchema,
  harnessStreamModeSchema,
  harnessTranscodeSessionSchema,
  type HarnessBootstrap,
  type HarnessMedia,
  type HarnessNextRoom,
  type HarnessRoom,
  type HarnessViewer,
} from "./contract";

const DEFAULT_SERVER_ID = "0019947d618464e70d2b754687dc070b9dd628a9";
const DEFAULT_RATING_KEY = "416224";
const DEFAULT_PORT = 4318;

const tokenFileSchema = z.object({
  accountA: z.object({ token: z.string().min(1) }),
  accountB: z.object({ token: z.string().min(1) }),
});

const portSchema = z.coerce.number().int().min(1).max(65_535);

interface AccountRuntime {
  readonly label: HarnessViewer["label"];
  readonly token: string;
  readonly tv: PlexTvClient;
  readonly userId: number;
  readonly server: PlexDevice;
  readonly serverClient: PlexServerClient;
  readonly serverUrl: string;
  readonly streamToken: string;
  readonly deviceIdentifier: string;
}

interface PreparedRuntime {
  readonly host: AccountRuntime;
  readonly guest: AccountRuntime;
  readonly watchTogether: WatchTogetherClient;
  readonly currentMedia: HarnessMedia;
  readonly nextMedia: HarnessMedia | null;
  readonly room: HarnessRoom;
}

const repoRoot = path.resolve(import.meta.dir, "../../..");
const tokenFilePath = process.env.WATCH_TOGETHER_HARNESS_TOKEN_FILE
  ? path.resolve(process.env.WATCH_TOGETHER_HARNESS_TOKEN_FILE)
  : path.join(repoRoot, ".watch-together-harness", "tokens.json");
const serverId = process.env.WATCH_TOGETHER_HARNESS_SERVER_ID ?? DEFAULT_SERVER_ID;
const ratingKey = process.env.WATCH_TOGETHER_HARNESS_RATING_KEY ?? DEFAULT_RATING_KEY;
const port = portSchema.parse(process.env.WATCH_TOGETHER_HARNESS_PORT ?? DEFAULT_PORT);
const streamMode = harnessStreamModeSchema.parse(
  process.env.WATCH_TOGETHER_HARNESS_STREAM_MODE ?? "direct-play",
);

const createdRoomIds = new Set<string>();
const activeTranscodeSessions = new Map<
  string,
  { readonly account: AccountRuntime; readonly sessionId: string }
>();
let preparedPromise: Promise<PreparedRuntime> | null = null;

function plexConfig(clientIdentifier: string): PlexConfig {
  return {
    product: "Multiplex Harness",
    version: "1.0.0",
    platform: "Chrome",
    clientIdentifier,
  };
}

function sourceUriFor(itemRatingKey: string): string {
  return `server://${serverId}/com.plexapp.plugins.library/library/metadata/${itemRatingKey}`;
}

function toHarnessRoom(room: {
  readonly id: string;
  readonly sourceUri: string;
  readonly syncplayHost: string;
  readonly syncplayPort: number;
}): HarnessRoom {
  return {
    id: room.id,
    sourceUri: room.sourceUri,
    syncplayHost: room.syncplayHost,
    syncplayPort: room.syncplayPort,
  };
}

function requireServer(servers: readonly PlexDevice[], accountLabel: string): PlexDevice {
  const server = servers.find((candidate) => candidate.clientIdentifier === serverId);
  if (!server) {
    throw new Error(
      `${accountLabel} cannot access Plex server ${serverId}. Set WATCH_TOGETHER_HARNESS_SERVER_ID to a server shared by both accounts.`,
    );
  }
  return server;
}

function toHarnessMedia(item: {
  readonly ratingKey?: string;
  readonly key?: string;
  readonly title?: string;
  readonly duration?: number;
  readonly Media?: ReadonlyArray<{
    readonly Part?: ReadonlyArray<{ readonly key?: string }>;
  }>;
}): HarnessMedia {
  const partKey = item.Media?.[0]?.Part?.[0]?.key;
  if (!item.ratingKey || !item.key || !partKey || !item.title || !item.duration) {
    throw new Error("Plex returned media without a rating key, metadata key, title, or duration.");
  }
  return {
    ratingKey: item.ratingKey,
    key: item.key,
    partKey,
    title: item.title,
    durationMs: item.duration,
  };
}

async function prepareAccount(input: {
  readonly label: AccountRuntime["label"];
  readonly token: string;
  readonly deviceIdentifier: string;
}): Promise<AccountRuntime> {
  const config = plexConfig(input.deviceIdentifier);
  const tv = new PlexTvClient(input.token, config);
  const [user, servers] = await Promise.all([tv.getUserInfo(), tv.getServers()]);
  const server = requireServer(servers, input.label);
  const serverClient = tv.createServerClient(server);
  await serverClient.getItemMetadata(ratingKey);
  const serverUrl = await serverClient.getConnectionUri();

  return {
    label: input.label,
    token: input.token,
    tv,
    userId: user.id,
    server,
    serverClient,
    serverUrl,
    streamToken: server.accessToken ?? input.token,
    deviceIdentifier: input.deviceIdentifier,
  };
}

async function loadTokens(): Promise<z.infer<typeof tokenFileSchema>> {
  let raw: string;
  try {
    raw = await readFile(tokenFilePath, "utf8");
  } catch {
    throw new Error(
      `Missing harness tokens at ${tokenFilePath}. Run "bun --filter @multiplex/watch-together-harness authenticate" first.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Harness token file ${tokenFilePath} is not valid JSON.`);
  }
  return tokenFileSchema.parse(parsed);
}

function viewerFor(account: AccountRuntime, item: HarnessMedia): HarnessViewer {
  return {
    label: account.label,
    token: account.streamToken,
    serverUrl: account.serverUrl,
    user: {
      id: account.userId,
      deviceIdentifier: account.deviceIdentifier,
      deviceName: "Multiplex Harness",
    },
    item,
  };
}

async function findNextMedia(
  host: AccountRuntime,
  current: HarnessMedia,
): Promise<HarnessMedia | null> {
  const queue = await host.serverClient.createPlayQueue({
    type: "video",
    uri: sourceUriFor(current.ratingKey),
    continuous: true,
    includeMarkers: true,
    includeChapters: true,
    shuffle: false,
    repeat: 0,
  });
  const items = queue.MediaContainer.Metadata ?? [];
  const currentIndex = items.findIndex((candidate) => candidate.ratingKey === current.ratingKey);
  const next = currentIndex >= 0 ? items[currentIndex + 1] : undefined;
  return next ? toHarnessMedia(next) : null;
}

async function createRoom(
  runtime: Pick<PreparedRuntime, "watchTogether" | "guest">,
  media: HarnessMedia,
): Promise<HarnessRoom> {
  const room = await runtime.watchTogether.createRoom({
    sourceUri: sourceUriFor(media.ratingKey),
    title: media.title,
    users: [runtime.guest.userId],
  });
  createdRoomIds.add(room.id);
  return toHarnessRoom(room);
}

async function prepareRuntime(): Promise<PreparedRuntime> {
  const tokens = await loadTokens();
  const [host, guest] = await Promise.all([
    prepareAccount({
      label: "Account A",
      token: tokens.accountA.token,
      deviceIdentifier: `multiplex-harness-a-${crypto.randomUUID()}`,
    }),
    prepareAccount({
      label: "Account B",
      token: tokens.accountB.token,
      deviceIdentifier: `multiplex-harness-b-${crypto.randomUUID()}`,
    }),
  ]);
  const hostMetadata = await host.serverClient.getItemMetadata(ratingKey);
  const guestMetadata = await guest.serverClient.getItemMetadata(ratingKey);
  if (!hostMetadata || !guestMetadata) {
    throw new Error(
      `Both accounts must be able to read rating key ${ratingKey} on server ${serverId}.`,
    );
  }
  const currentMedia = toHarnessMedia(hostMetadata);
  const guestMedia = toHarnessMedia(guestMetadata);
  if (guestMedia.ratingKey !== currentMedia.ratingKey) {
    throw new Error("The two accounts resolved different Plex media items.");
  }

  const watchTogether = new WatchTogetherClient(
    tokens.accountA.token,
    plexConfig(host.deviceIdentifier),
  );
  const partialRuntime = { host, guest, watchTogether };
  const [nextMedia, room] = await Promise.all([
    findNextMedia(host, currentMedia),
    createRoom(partialRuntime, currentMedia),
  ]);

  return { host, guest, watchTogether, currentMedia, nextMedia, room };
}

async function runtime(): Promise<PreparedRuntime> {
  preparedPromise ??= prepareRuntime();
  return await preparedPromise;
}

async function bootstrapResponse(): Promise<HarnessBootstrap> {
  const prepared = await runtime();
  return harnessBootstrapSchema.parse({
    room: prepared.room,
    streamMode,
    viewers: [
      viewerFor(prepared.host, prepared.currentMedia),
      viewerFor(prepared.guest, prepared.currentMedia),
    ],
    nextEpisode: prepared.nextMedia,
  });
}

async function nextRoomResponse(): Promise<HarnessNextRoom> {
  const prepared = await runtime();
  if (!prepared.nextMedia) {
    throw new Error("The selected episode has no next episode in its Plex play queue.");
  }

  const [room, hostMetadata, guestMetadata] = await Promise.all([
    createRoom(prepared, prepared.nextMedia),
    prepared.host.serverClient.getItemMetadata(prepared.nextMedia.ratingKey),
    prepared.guest.serverClient.getItemMetadata(prepared.nextMedia.ratingKey),
  ]);
  if (!hostMetadata || !guestMetadata) {
    throw new Error("Both accounts must be able to read the next episode.");
  }
  const nextAfter = await findNextMedia(prepared.host, toHarnessMedia(hostMetadata));
  return harnessNextRoomSchema.parse({
    room,
    streamMode,
    viewers: [
      viewerFor(prepared.host, toHarnessMedia(hostMetadata)),
      viewerFor(prepared.guest, toHarnessMedia(guestMetadata)),
    ],
    nextEpisode: nextAfter,
  });
}

async function cleanupRooms(): Promise<void> {
  const prepared = await runtime().catch(() => null);
  if (!prepared) return;
  await Promise.all(
    [...createdRoomIds].map(async (roomId) => {
      await prepared.watchTogether.deleteRoom(roomId).catch(() => undefined);
      createdRoomIds.delete(roomId);
    }),
  );
}

function transcodeSessionKey(label: AccountRuntime["label"], sessionId: string): string {
  return `${label}:${sessionId}`;
}

function accountForLabel(
  prepared: PreparedRuntime,
  label: AccountRuntime["label"],
): AccountRuntime {
  return label === "Account A" ? prepared.host : prepared.guest;
}

async function stopTranscodeSession(account: AccountRuntime, sessionId: string): Promise<void> {
  const base = account.serverUrl.replace(/\/$/, "");
  const url = new URL(`${base}/video/:/transcode/universal/stop`);
  url.searchParams.set("session", sessionId);
  url.searchParams.set("X-Plex-Token", account.streamToken);
  url.searchParams.set("X-Plex-Client-Identifier", account.deviceIdentifier);
  await fetch(url).catch(() => undefined);
  activeTranscodeSessions.delete(transcodeSessionKey(account.label, sessionId));
}

async function registerTranscodeSession(request: Request): Promise<void> {
  const input = harnessTranscodeSessionSchema.parse(await request.json());
  const prepared = await runtime();
  const account = accountForLabel(prepared, input.label);
  activeTranscodeSessions.set(transcodeSessionKey(input.label, input.sessionId), {
    account,
    sessionId: input.sessionId,
  });
}

async function stopRegisteredTranscodeSession(request: Request): Promise<void> {
  const input = harnessTranscodeSessionSchema.parse(await request.json());
  const prepared = await runtime();
  await stopTranscodeSession(accountForLabel(prepared, input.label), input.sessionId);
}

async function cleanupTranscodeSessions(): Promise<void> {
  await Promise.all(
    [...activeTranscodeSessions.values()].map(({ account, sessionId }) =>
      stopTranscodeSession(account, sessionId),
    ),
  );
}

function jsonError(error: Error): Response {
  return Response.json({ error: error.message }, { status: 500 });
}

const clientBuild = await Bun.build({
  entrypoints: [path.join(import.meta.dir, "client.ts")],
  target: "browser",
  format: "esm",
  minify: false,
  sourcemap: "none",
});
if (!clientBuild.success) {
  throw new Error(
    `Harness client build failed: ${clientBuild.logs.map((log) => log.message).join("; ")}`,
  );
}
const clientOutput = clientBuild.outputs[0];
if (!clientOutput) {
  throw new Error("Harness client build produced no JavaScript output.");
}
const clientJavaScript = await clientOutput.text();
const indexHtml = await Bun.file(path.join(import.meta.dir, "index.html")).text();
const styles = await Bun.file(path.join(import.meta.dir, "styles.css")).text();

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/") {
        return new Response(indexHtml, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (request.method === "GET" && url.pathname === "/client.js") {
        return new Response(clientJavaScript, {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        });
      }
      if (request.method === "GET" && url.pathname === "/styles.css") {
        return new Response(styles, {
          headers: { "content-type": "text/css; charset=utf-8" },
        });
      }
      if (request.method === "GET" && url.pathname === "/api/bootstrap") {
        return Response.json(await bootstrapResponse(), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (request.method === "POST" && url.pathname === "/api/next-room") {
        return Response.json(await nextRoomResponse(), {
          headers: { "cache-control": "no-store" },
        });
      }
      if (request.method === "POST" && url.pathname === "/api/cleanup") {
        await Promise.all([cleanupRooms(), cleanupTranscodeSessions()]);
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST" && url.pathname === "/api/transcode/register") {
        await registerTranscodeSession(request);
        return new Response(null, { status: 204 });
      }
      if (request.method === "POST" && url.pathname === "/api/transcode/stop") {
        await stopRegisteredTranscodeSession(request);
        return new Response(null, { status: 204 });
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      return jsonError(error instanceof Error ? error : new Error("Unknown harness error"));
    }
  },
});

const shutdown = async (): Promise<void> => {
  await Promise.all([cleanupRooms(), cleanupTranscodeSessions()]);
  await server.stop();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

console.log(`Watch Together harness: http://${server.hostname}:${server.port}`);
console.log(`Fixture: server ${serverId}, rating key ${ratingKey}`);
