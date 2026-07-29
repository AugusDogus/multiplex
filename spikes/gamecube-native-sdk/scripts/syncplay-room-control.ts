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

interface StoredConsoleAuth {
  generation: number;
  origin: string;
  sessionToken: string;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultMemoryCard = path.resolve(scriptDirectory, "../.dolphin-user/GC/MemoryCardA.EUR.raw");

const command = process.argv[2];
const argument = process.argv[3];
if (!["seek", "pause", "resume"].includes(command ?? "")) {
  throw new Error("Usage: bun syncplay-room-control.ts seek <milliseconds> | pause | resume");
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

const roomsUrl = new URL(
  "/api/trpc/plex.getWatchTogetherRooms?input=%7B%22json%22%3Anull%7D",
  auth.origin,
);
let roomsResponse = await fetch(roomsUrl, {
  headers: { Authorization: auth.sessionToken },
});
if (roomsResponse.status === 401 && !auth.sessionToken.startsWith("Bearer ")) {
  roomsResponse = await fetch(roomsUrl, {
    headers: { Authorization: `Bearer ${auth.sessionToken}` },
  });
}
if (!roomsResponse.ok) {
  throw new Error(`Room request failed with HTTP ${roomsResponse.status}.`);
}
const envelope = authEnvelopeSchema.parse(await roomsResponse.json());
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
    records.push({
      generation: readBe32(bytes, offset + 8),
      origin: decodeUtf8(bytes.subarray(fields, fields + originLength)),
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
