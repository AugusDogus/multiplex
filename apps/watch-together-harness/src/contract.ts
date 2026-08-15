import { z } from "zod";

export const harnessMediaSchema = z.object({
  ratingKey: z.string().min(1),
  key: z.string().min(1),
  partKey: z.string().min(1),
  title: z.string().min(1),
  durationMs: z.number().positive(),
});

export const harnessStreamModeSchema = z.enum(["direct-play", "transcode"]);

export const harnessRoomSchema = z.object({
  id: z.string().min(1),
  sourceUri: z.string().min(1),
  syncplayHost: z.string().min(1),
  syncplayPort: z.number().int().positive(),
});

export const harnessViewerSchema = z.object({
  label: z.enum(["Account A", "Account B"]),
  token: z.string().min(1),
  serverUrl: z.string().url(),
  user: z.object({
    id: z.number().int(),
    deviceIdentifier: z.string().min(1),
    deviceName: z.literal("Multiplex Harness"),
  }),
  item: harnessMediaSchema,
});

export const harnessBootstrapSchema = z.object({
  room: harnessRoomSchema,
  streamMode: harnessStreamModeSchema,
  viewers: z.tuple([harnessViewerSchema, harnessViewerSchema]),
  nextEpisode: harnessMediaSchema.nullable(),
});

export const harnessNextRoomSchema = z.object({
  room: harnessRoomSchema,
  streamMode: harnessStreamModeSchema,
  viewers: z.tuple([harnessViewerSchema, harnessViewerSchema]),
  nextEpisode: harnessMediaSchema.nullable(),
});

export const harnessTranscodeSessionSchema = z.object({
  label: z.enum(["Account A", "Account B"]),
  sessionId: z.string().min(1).max(200),
});

export type HarnessMedia = z.infer<typeof harnessMediaSchema>;
export type HarnessRoom = z.infer<typeof harnessRoomSchema>;
export type HarnessStreamMode = z.infer<typeof harnessStreamModeSchema>;
export type HarnessViewer = z.infer<typeof harnessViewerSchema>;
export type HarnessBootstrap = z.infer<typeof harnessBootstrapSchema>;
export type HarnessNextRoom = z.infer<typeof harnessNextRoomSchema>;
