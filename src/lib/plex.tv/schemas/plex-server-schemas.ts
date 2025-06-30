import { z } from "zod";

/* ────────────────────────────────────────────────────────────
   Plex Media Server Schemas
   Schemas for PlexServerClient - media providers, libraries
   ──────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────
   Directory Schemas
   ──────────────────────────────────────────────────────────── */

// Simplified directory schemas - break these out instead of complex unions
const BaseDirectorySchema = z.object({
  title: z.string(),
});

const LibrarySectionSchema = BaseDirectorySchema.extend({
  id: z.string(),
  key: z.string(),
  hubKey: z.string(),
  type: z.string(), // movie, show, artist, etc.
  agent: z.string(),
  language: z.string(),
  refreshing: z.boolean(),
  scanner: z.string(),
  uuid: z.string(),
  updatedAt: z.number(),
  scannedAt: z.number(),
  Pivot: z
    .array(
      z.object({
        id: z.string(),
        key: z.string(),
        type: z.string(),
        title: z.string(),
        context: z.string(),
        symbol: z.string(),
      }),
    )
    .optional(),
});

const PlaylistDirectorySchema = BaseDirectorySchema.extend({
  id: z.literal("playlists"),
  key: z.string(),
  type: z.literal("playlist"),
  Pivot: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      type: z.string(),
      title: z.string(),
      context: z.string(),
      symbol: z.string(),
    }),
  ),
});

const LiveTVDirectorySchema = BaseDirectorySchema.extend({
  id: z.string(),
  hubKey: z.string().optional(),
  Pivot: z
    .array(
      z.object({
        id: z.string(),
        key: z.string(),
        type: z.string(),
        title: z.string(),
        context: z.string(),
        symbol: z.string(),
      }),
    )
    .optional(),
});

const HomeDirectorySchema = BaseDirectorySchema.extend({
  hubKey: z.literal("/hubs"),
});

const GenericDirectorySchema = BaseDirectorySchema.extend({
  type: z.string().optional(),
  key: z.string().optional(),
  icon: z.string().optional(),
  updatedAt: z.number().optional(),
});

// Simple union of all directory types
const DirectorySchema = z.union([
  LibrarySectionSchema,
  PlaylistDirectorySchema,
  LiveTVDirectorySchema,
  HomeDirectorySchema,
  GenericDirectorySchema,
]);

/* ────────────────────────────────────────────────────────────
   Feature & MediaProvider Schemas
   ──────────────────────────────────────────────────────────── */

// Simplified Feature schema
const FeatureSchema = z.object({
  key: z.string().optional(),
  type: z.string(),
  Directory: z.array(DirectorySchema).optional(),
  Action: z
    .array(
      z.object({
        id: z.string(),
        key: z.string(),
      }),
    )
    .optional(),
  flavor: z.string().optional(),
  scrobbleKey: z.string().optional(),
  unscrobbleKey: z.string().optional(),
});

// Simplified MediaProvider schema
const MediaProviderSchema = z.object({
  identifier: z.string().optional(),
  title: z.string(),
  types: z.string().optional(),
  protocols: z.string().optional(),
  Feature: z.array(FeatureSchema),
  // LiveTV specific fields
  id: z.number().optional(),
  parentID: z.number().optional(),
  providerIdentifier: z.string().optional(),
  epgSource: z.string().optional(),
  friendlyName: z.string().optional(),
});

/* ────────────────────────────────────────────────────────────
   MediaContainer Schema
   ──────────────────────────────────────────────────────────── */

// Clean MediaContainer schema
export const MediaContainerSchema = z.object({
  MediaContainer: z
    .object({
      size: z.number(),
      allowCameraUpload: z.boolean().optional(),
      allowChannelAccess: z.boolean().optional(),
      allowMediaDeletion: z.boolean().optional(),
      allowSharing: z.boolean().optional(),
      allowSync: z.boolean().optional(),
      allowTuners: z.boolean().optional(),
      friendlyName: z.string(),
      machineIdentifier: z.string(),
      MediaProvider: z.array(MediaProviderSchema),
      // ... other MediaContainer properties can be added as needed
    })
    .passthrough(), // Allow other properties we don't care about
});

/* ────────────────────────────────────────────────────────────
   Type Guards & Utilities
   ──────────────────────────────────────────────────────────── */

// Type guards for runtime type checking
export function isLibrarySection(
  dir: Directory,
): dir is z.infer<typeof LibrarySectionSchema> {
  return (
    "id" in dir && "type" in dir && "hubKey" in dir && dir.type !== "playlist"
  );
}

export function isPlaylistDirectory(
  dir: Directory,
): dir is z.infer<typeof PlaylistDirectorySchema> {
  return "id" in dir && dir.id === "playlists";
}

export function isLiveTVDirectory(
  dir: Directory,
): dir is z.infer<typeof LiveTVDirectorySchema> {
  return (
    "id" in dir &&
    typeof dir.id === "string" &&
    dir.id.includes("tv.plex.providers")
  );
}

export function isHomeDirectory(
  dir: Directory,
): dir is z.infer<typeof HomeDirectorySchema> {
  return "hubKey" in dir && dir.hubKey === "/hubs";
}

/* ────────────────────────────────────────────────────────────
   Type Exports
   ──────────────────────────────────────────────────────────── */

export type MediaContainer = z.infer<typeof MediaContainerSchema>;
export type MediaProvider = z.infer<typeof MediaProviderSchema>;
export type Directory = z.infer<typeof DirectorySchema>;
export type LibrarySection = z.infer<typeof LibrarySectionSchema>;
