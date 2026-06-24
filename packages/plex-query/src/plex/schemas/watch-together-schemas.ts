import { z } from "zod";

export const watchTogetherUserSchema = z
  .object({
    id: z.number(),
    title: z.string().nullish(),
    username: z.string().nullish(),
    thumb: z.string().nullish(),
  })
  .passthrough();

export const watchTogetherRoomSchema = z
  .object({
    id: z.string(),
    sourceUri: z.string(),
    source: z.string().optional(),
    title: z.string(),
    type: z.string(),
    startsAt: z.number().optional(),
    endsAt: z.number().optional(),
    updatedAt: z.number().optional(),
    syncplayHost: z.string(),
    syncplayPort: z.number(),
    users: z.array(watchTogetherUserSchema).default([]),
  })
  .passthrough();

export const watchTogetherRoomsResponseSchema = z.object({
  rooms: z.array(watchTogetherRoomSchema),
});

export const plexFriendSchema = z
  .object({
    id: z.number(),
    uuid: z.string(),
    title: z.string().nullish(),
    username: z.string(),
    friendlyName: z.string().nullish(),
    thumb: z.string().nullish(),
    restricted: z.boolean().optional(),
  })
  .passthrough();

export const plexFriendsSchema = z.array(plexFriendSchema);

export type WatchTogetherUser = z.infer<typeof watchTogetherUserSchema>;
export type WatchTogetherRoom = z.infer<typeof watchTogetherRoomSchema>;
export type WatchTogetherRoomsResponse = z.infer<typeof watchTogetherRoomsResponseSchema>;
export type PlexFriend = z.infer<typeof plexFriendSchema>;
