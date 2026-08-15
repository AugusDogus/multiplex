#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SyncplayClient,
  watchTogetherRoomSchema,
  watchTogetherRoomsResponseSchema,
} from "@multiplex/plex-query";
import { z } from "zod";

const roomsPayloadSchema = z
  .union([watchTogetherRoomsResponseSchema, z.array(watchTogetherRoomSchema)])
  .transform((payload) => (Array.isArray(payload) ? payload : payload.rooms));
const authEnvelopeSchema = z.object({
  result: z.object({
    data: z.object({
      json: roomsPayloadSchema,
    }),
  }),
});
const inviteesEnvelopeSchema = z.object({
  result: z.object({
    data: z.object({
      json: z.array(
        z.object({
          id: z.number(),
          username: z.string(),
        }),
      ),
    }),
  }),
});
const currentUserEnvelopeSchema = z.object({
  result: z.object({
    data: z.object({
      json: z.object({
        id: z.number(),
        username: z.string(),
        title: z.string(),
      }),
    }),
  }),
});

interface StoredConsoleAuth {
  generation: number;
  origin: string;
  plexClientId: string;
  plexServerToken: string;
  plexServerUrl: string;
  sessionToken: string;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultMemoryCard = path.resolve(scriptDirectory, "../.dolphin-user/GC/MemoryCardA.USA.raw");

const command = process.argv[2];
const argument = process.argv[3];
if (
  ![
    "seek",
    "pause",
    "resume",
    "current-user",
    "list-invitees",
    "list-rooms",
    "create-room",
    "delete-room",
    "join-lobby",
    "stop-pms-session",
  ].includes(command ?? "")
) {
  throw new Error(
    "Usage: bun syncplay-room-control.ts seek <milliseconds> | pause | resume | current-user | list-invitees | list-rooms | create-room <invitee-id> | delete-room <room-id> | join-lobby <user-id> | stop-pms-session",
  );
}

const targetPositionMs = command === "seek" ? Number.parseInt(argument ?? "", 10) : 0;
if (command === "seek" && (!Number.isSafeInteger(targetPositionMs) || targetPositionMs < 0)) {
  throw new Error("The seek position must be a non-negative integer.");
}

const memoryCardPath = process.env.GAMECUBE_MEMORY_CARD_PATH ?? defaultMemoryCard;
const auth = newestAuthRecord(await readFile(memoryCardPath));
if (!auth) {
  throw new Error(`No valid Multiplex auth record found in ${memoryCardPath}`);
}

if (command === "stop-pms-session") {
  await stopPmsSessions(auth);
  process.exit(0);
}

if (command === "delete-room") {
  const roomId = z
    .string()
    .regex(/^[A-Za-z0-9]+$/)
    .parse(argument);
  const deleteUrl = new URL("/api/trpc/plex.deleteWatchTogetherRoom", auth.origin);
  const response = await fetchWithSession(deleteUrl, auth.sessionToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ json: { roomId } }),
  });
  if (!response.ok) {
    throw new Error(`Room deletion for ${roomId} failed with HTTP ${response.status}.`);
  }
  console.log(`Deleted Watch Together room ${roomId}.`);
  process.exit(0);
}

if (command === "list-invitees") {
  const inviteesUrl = new URL(
    "/api/trpc/plex.getWatchTogetherInvitees?input=%7B%22json%22%3Anull%7D",
    auth.origin,
  );
  const response = await fetchWithSession(inviteesUrl, auth.sessionToken);
  if (!response.ok) {
    throw new Error(`Invitee request failed with HTTP ${response.status}.`);
  }
  const invitees = inviteesEnvelopeSchema.parse(await response.json()).result.data.json;
  for (const invitee of invitees) {
    console.log(`${invitee.id}\t${invitee.username}`);
  }
  process.exit(0);
}

if (command === "current-user") {
  const currentUserUrl = new URL(
    "/api/trpc/plex.getUserInfo?input=%7B%22json%22%3Anull%7D",
    auth.origin,
  );
  const response = await fetchWithSession(currentUserUrl, auth.sessionToken);
  if (!response.ok) {
    throw new Error(`Current user request failed with HTTP ${response.status}.`);
  }
  const user = currentUserEnvelopeSchema.parse(await response.json()).result.data.json;
  console.log(`${user.id}\t${user.username}\t${user.title}`);
  process.exit(0);
}

const roomsUrl = new URL(
  "/api/trpc/plex.getWatchTogetherRooms?input=%7B%22json%22%3Anull%7D",
  auth.origin,
);
const roomsResponse = await fetchWithSession(roomsUrl, auth.sessionToken);
if (!roomsResponse.ok) {
  throw new Error(`Room request failed with HTTP ${roomsResponse.status}.`);
}
const envelope = authEnvelopeSchema.parse(await roomsResponse.json());
if (command === "list-rooms") {
  for (const candidate of envelope.result.data.json) {
    console.log(
      `${candidate.id}\t${candidate.users.length}\t${candidate.sourceUri}\t${candidate.title}`,
    );
  }
  process.exit(0);
}
if (command === "create-room") {
  const inviteeId = Number.parseInt(argument ?? "", 10);
  const source = envelope.result.data.json[0];
  const sourceMatch = source?.sourceUri.match(
    /^server:\/\/([^/]+)\/com\.plexapp\.plugins\.library(\/library\/metadata\/(\d+))$/,
  );
  if (!Number.isSafeInteger(inviteeId) || inviteeId <= 0 || !source || !sourceMatch) {
    throw new Error("create-room requires an invitee id and an existing source room.");
  }
  const createUrl = new URL("/api/trpc/plex.createWatchTogetherRoom", auth.origin);
  const response = await fetchWithSession(createUrl, auth.sessionToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      json: {
        serverId: sourceMatch[1],
        ratingKey: sourceMatch[3],
        key: sourceMatch[2],
        title: source.title,
        users: [inviteeId],
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Room creation failed with HTTP ${response.status}.`);
  }
  const created = authEnvelopeSchema
    .extend({
      result: z.object({
        data: z.object({ json: watchTogetherRoomSchema }),
      }),
    })
    .parse(await response.json()).result.data.json;
  console.log(`${created.id}\t${created.users.length}\t${created.title}`);
  process.exit(0);
}
const requestedRoomId = process.env.MULTIPLEX_WATCH_TOGETHER_ROOM_ID;
const room = requestedRoomId
  ? envelope.result.data.json.find((candidate) => candidate.id === requestedRoomId)
  : envelope.result.data.json[0];
if (!room) {
  throw new Error(
    requestedRoomId
      ? `Watch Together room ${requestedRoomId} was not found.`
      : "No Watch Together room is available.",
  );
}

if (command === "join-lobby") {
  const userId = Number.parseInt(argument ?? "", 10);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("join-lobby requires a positive Plex user id.");
  }
  let opened = false;
  let closed = false;
  const observer = new SyncplayClient({
    room,
    observer: true,
    user: {
      id: userId,
      deviceIdentifier: `multiplex-dolphin-lobby-${Date.now().toString(36)}`,
      deviceName: "Multiplex Dolphin lobby",
    },
    onOpen: () => {
      opened = true;
      observer.setFile();
      observer.setReady(false);
    },
    onClose: () => {
      closed = true;
    },
    onError: () => {
      closed = true;
    },
  });
  observer.connect();
  const deadline = Date.now() + 120_000;
  while (!closed && Date.now() < deadline) {
    await Bun.sleep(100);
  }
  observer.disconnect();
  if (!opened) {
    throw new Error("The Syncplay lobby observer did not connect.");
  }
  console.log(`Syncplay lobby observer completed for user ${userId}.`);
  process.exit(0);
}

let actionStartedAt = 0;
let actionArmed = false;
let acknowledged = false;
let closed = false;
let roomPaused = true;
const startPositionSeconds = targetPositionMs / 1000;
let roomPositionSeconds = 0;

const client = new SyncplayClient({
  room,
  user: {
    id: 0,
    deviceIdentifier: `multiplex-dolphin-control-${Date.now().toString(36)}`,
    deviceName: "Multiplex Dolphin control",
  },
  getPlaybackState: () => ({
    isPaused: roomPaused,
    positionSeconds:
      roomPaused || !actionArmed
        ? roomPositionSeconds
        : roomPositionSeconds + (Date.now() - actionStartedAt) / 1000,
  }),
  onOpen: () => {
    client.setFile();
    client.setReady(true);
  },
  onRoomState: (state) => {
    if (!actionArmed) {
      actionArmed = true;
      actionStartedAt = Date.now();
      roomPaused = command === "pause" ? true : command === "resume" ? false : state.paused;
      roomPositionSeconds = command === "seek" ? startPositionSeconds : state.positionSeconds;
      if (command === "seek") {
        client.markLocalSeek();
      } else {
        client.markLocalPlayPause();
      }
      return;
    }
    const targetPaused = command === "pause" ? true : command === "resume" ? false : roomPaused;
    const positionMatches =
      command !== "seek" || Math.abs(state.positionSeconds - startPositionSeconds) < 3;
    if (
      actionArmed &&
      Date.now() - actionStartedAt > 500 &&
      state.paused === targetPaused &&
      positionMatches
    ) {
      acknowledged = true;
    }
  },
  onClose: () => {
    closed = true;
  },
  onError: () => {
    closed = true;
  },
});

client.connect();
const deadline = Date.now() + 20_000;
while (!acknowledged && !closed && Date.now() < deadline) {
  await Bun.sleep(100);
}
client.disconnect();

if (!acknowledged) {
  throw new Error("Syncplay did not acknowledge the requested room state.");
}
console.log(
  command === "seek"
    ? `Syncplay seek acknowledged at ${targetPositionMs}ms.`
    : `Syncplay ${command} acknowledged.`,
);

async function fetchWithSession(
  url: URL,
  sessionToken: string,
  init: RequestInit = {},
): Promise<Response> {
  let response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: sessionToken },
  });
  if (response.status === 401 && !sessionToken.startsWith("Bearer ")) {
    response = await fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${sessionToken}` },
    });
  }
  return response;
}

async function stopPmsSessions(auth: StoredConsoleAuth): Promise<void> {
  if (!auth.plexClientId || !auth.plexServerToken || !auth.plexServerUrl) {
    throw new Error("The GameCube auth record has no saved PMS credentials.");
  }
  const headers = { "X-Plex-Token": auth.plexServerToken };
  const sessionsUrl = new URL("/status/sessions", auth.plexServerUrl);
  const response = await fetch(sessionsUrl, { headers });
  if (!response.ok) {
    throw new Error(`PMS session request failed with HTTP ${response.status}.`);
  }
  const xml = await response.text();
  const videoBlocks = xml.match(/<Video\b[\s\S]*?<\/Video>/g) ?? [];
  let stopped = 0;
  for (const video of videoBlocks) {
    const player = video.match(/<Player\b[^>]*\/>/)?.[0];
    if (
      !player ||
      xmlAttribute(player, "machineIdentifier") !== auth.plexClientId ||
      xmlAttribute(player, "product") !== "Multiplex" ||
      xmlAttribute(player, "device") !== "GameCube"
    ) {
      continue;
    }
    const playbackSessionId = xmlAttribute(player, "playbackSessionId");
    if (playbackSessionId) {
      const stopUrl = new URL("/:/transcode/universal/stop", auth.plexServerUrl);
      stopUrl.searchParams.set("session", playbackSessionId);
      const stopResponse = await fetch(stopUrl, { headers });
      if (!stopResponse.ok && stopResponse.status !== 404) {
        throw new Error(
          `PMS transcode stop for ${playbackSessionId} failed with HTTP ${stopResponse.status}.`,
        );
      }
    }
    const videoTag = video.match(/<Video\b[^>]*>/)?.[0];
    const ratingKey = videoTag ? xmlAttribute(videoTag, "ratingKey") : undefined;
    if (ratingKey) {
      const timelineUrl = new URL("/:/timeline", auth.plexServerUrl);
      timelineUrl.searchParams.set("ratingKey", ratingKey);
      timelineUrl.searchParams.set("key", `/library/metadata/${ratingKey}`);
      timelineUrl.searchParams.set("state", "stopped");
      timelineUrl.searchParams.set("time", xmlAttribute(videoTag, "viewOffset") ?? "0");
      timelineUrl.searchParams.set("duration", xmlAttribute(videoTag, "duration") ?? "0");
      const timelineResponse = await fetch(timelineUrl, {
        headers: {
          ...headers,
          "X-Plex-Client-Identifier": auth.plexClientId,
        },
      });
      if (!timelineResponse.ok) {
        throw new Error(
          `PMS stopped timeline for ${ratingKey} failed with HTTP ${timelineResponse.status}.`,
        );
      }
    }
    stopped += 1;
  }
  console.log(`Stopped ${stopped} Multiplex GameCube PMS session(s).`);
}

function xmlAttribute(tag: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escapedName}="([^"]*)"`).exec(tag)?.[1];
}

function newestAuthRecord(bytes: Uint8Array): StoredConsoleAuth | null {
  const records: StoredConsoleAuth[] = [];
  for (let offset = 0; offset + 48 <= bytes.length; ++offset) {
    if (
      bytes[offset] !== 0x4d ||
      bytes[offset + 1] !== 0x50 ||
      bytes[offset + 2] !== 0x58 ||
      bytes[offset + 3] !== 0x41
    ) {
      continue;
    }
    const version = readBe16(bytes, offset + 4);
    const headerSize = readBe16(bytes, offset + 6);
    const payloadSize = readBe32(bytes, offset + 12);
    const recordSize = headerSize + payloadSize;
    if (
      version !== 2 ||
      headerSize !== 24 ||
      payloadSize < 24 ||
      offset + recordSize > bytes.length ||
      crc32(bytes.subarray(offset, offset + 20)) !== readBe32(bytes, offset + 20) ||
      crc32(bytes.subarray(offset + headerSize, offset + recordSize)) !==
        readBe32(bytes, offset + 16)
    ) {
      continue;
    }
    const payload = offset + headerSize;
    const originLength = readBe16(bytes, payload + 8);
    const sessionTokenLength = readBe16(bytes, payload + 10);
    const fieldLengths = Array.from({ length: 8 }, (_, index) =>
      readBe16(bytes, payload + 8 + index * 2),
    );
    const fieldBytes = fieldLengths.reduce((total, length) => total + length, 0);
    if (originLength === 0 || sessionTokenLength === 0 || fieldBytes !== payloadSize - 24) {
      continue;
    }
    const fields = payload + 24;
    const plexTokenLength = fieldLengths[2] ?? 0;
    const plexClientIdLength = fieldLengths[3] ?? 0;
    const plexServerUrlLength = fieldLengths[4] ?? 0;
    const plexServerTokenLength = fieldLengths[5] ?? 0;
    const plexTokenStart = fields + originLength + sessionTokenLength;
    const plexClientIdStart = plexTokenStart + plexTokenLength;
    const plexServerUrlStart = plexClientIdStart + plexClientIdLength;
    const plexServerTokenStart = plexServerUrlStart + plexServerUrlLength;
    records.push({
      generation: readBe32(bytes, offset + 8),
      origin: decodeUtf8(bytes.subarray(fields, fields + originLength)),
      plexClientId: decodeUtf8(
        bytes.subarray(plexClientIdStart, plexClientIdStart + plexClientIdLength),
      ),
      plexServerToken: decodeUtf8(
        bytes.subarray(plexServerTokenStart, plexServerTokenStart + plexServerTokenLength),
      ),
      plexServerUrl: decodeUtf8(
        bytes.subarray(plexServerUrlStart, plexServerUrlStart + plexServerUrlLength),
      ),
      sessionToken: decodeUtf8(
        bytes.subarray(fields + originLength, fields + originLength + sessionTokenLength),
      ),
    });
  }
  const expectedOrigin = process.env.MULTIPLEX_BASE_URL ?? "https://multiplex.localhost";
  const matchingRecords = records.filter((record) => record.origin === expectedOrigin);
  return (
    matchingRecords.length === 0 ? records : matchingRecords
  ).reduce<StoredConsoleAuth | null>(
    (newest, record) =>
      newest === null || record.generation >= newest.generation ? record : newest,
    null,
  );
}

function readBe16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x100 + bytes[offset + 1]!;
}

function readBe32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; ++bit) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return ~crc >>> 0;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
