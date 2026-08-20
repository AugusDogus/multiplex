import { z } from "zod";

import { ContinueWatchingMetadata } from "../plex/schemas/continue-watching-schemas";
import { watchTogetherRoomSchema } from "../plex/schemas/watch-together-schemas";

const serializedPlexDateSchema = z
  .string()
  .datetime()
  .transform((value) => new Date(value));

const serializedPlayableMetadataSchema = ContinueWatchingMetadata.extend({
  lastViewedAt: serializedPlexDateSchema.optional(),
  includedAt: serializedPlexDateSchema.optional(),
  addedAt: serializedPlexDateSchema.optional(),
  updatedAt: serializedPlexDateSchema.optional(),
  streamPartKey: z.string().min(1),
});

export const guestNextEpisodeSchema = z.object({
  ratingKey: z.string().min(1),
  key: z.string().min(1),
  title: z.string(),
  index: z.number(),
  parentIndex: z.number(),
  thumb: z.string().optional(),
  art: z.string().optional(),
  duration: z.number().optional(),
  summary: z.string().optional(),
  grandparentTitle: z.string().optional(),
  parentTitle: z.string().optional(),
});

export const guestWatchTogetherBootstrapValueSchema = z.object({
  room: watchTogetherRoomSchema.pick({
    id: true,
    sourceUri: true,
    title: true,
    type: true,
    syncplayHost: true,
    syncplayPort: true,
    users: true,
  }),
  host: z.object({ id: z.number(), title: z.string() }),
  guest: z.object({ id: z.number(), title: z.string() }),
  serverId: z.string().min(1),
  serverUrl: z.string().url(),
  authToken: z.string().min(1),
  item: serializedPlayableMetadataSchema,
  nextEpisode: guestNextEpisodeSchema.nullable().default(null),
});

export const guestWatchTogetherBootstrapResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: guestWatchTogetherBootstrapValueSchema,
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["invalid-invite", "expired-invite", "room-unavailable", "guest-unavailable"]),
  }),
]);

export type GuestWatchTogetherBootstrapValue = z.infer<
  typeof guestWatchTogetherBootstrapValueSchema
>;

export type GuestNextEpisode = z.infer<typeof guestNextEpisodeSchema>;

export const guestWatchTogetherContinuationResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    capability: z.string().min(1),
    value: guestWatchTogetherBootstrapValueSchema,
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum([
      "pending",
      "invalid-invite",
      "expired-invite",
      "room-unavailable",
      "guest-unavailable",
    ]),
  }),
]);
