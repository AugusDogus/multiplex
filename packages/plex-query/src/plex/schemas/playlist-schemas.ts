import { z } from "zod";

/* ────────────────────────────────────────────────────────────
   Playlist Schemas
   Shapes for the playlist list / create / add-item endpoints used by
   the item details "Add to..." action.
   ──────────────────────────────────────────────────────────── */

/** The Plex `playlistType` of a playlist, which gates which items it accepts. */
export const playlistTypes = ["audio", "video", "photo"] as const;
export type PlaylistType = (typeof playlistTypes)[number];

export const LOCAL_LIBRARY_PROVIDER_IDENTIFIER = "com.plexapp.plugins.library";

const playlistBaseSchema = z.object({
  ratingKey: z.string(),
  key: z.string(),
  guid: z.string().optional(),
  type: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  smart: z.boolean().optional(),
  playlistType: z.string().optional(),
  composite: z.string().optional(),
  icon: z.string().optional(),
  duration: z.number().optional(),
  leafCount: z.number().optional(),
  addedAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

/** A credential-free playlist summary returned by Plex list endpoints. */
export const playlistSchema = playlistBaseSchema;

/** Detailed playlist metadata. Smart playlists may include their generator URI. */
export const playlistDetailSchema = playlistBaseSchema.extend({
  content: z.string().optional(),
});

/**
 * A playlist entry. `playlistItemID` identifies the entry in a dumb playlist;
 * it is deliberately distinct from the media item's `ratingKey`.
 */
export const playlistItemSchema = z.object({
  ratingKey: z.string(),
  key: z.string(),
  type: z.string(),
  title: z.string(),
  playlistItemID: z.number().int().positive().optional(),
  thumb: z.string().optional(),
  parentThumb: z.string().optional(),
  grandparentThumb: z.string().optional(),
  parentTitle: z.string().optional(),
  grandparentTitle: z.string().optional(),
  year: z.number().optional(),
  duration: z.number().optional(),
  index: z.number().optional(),
  parentIndex: z.number().optional(),
});

export const playlistsResponseSchema = z.object({
  MediaContainer: z
    .object({
      size: z.number().optional(),
      // Plex omits `Metadata` entirely when the user has no playlists.
      Metadata: z.array(playlistSchema).optional(),
      // `PUT /playlists/{id}/items` reports how many items were appended.
      leafCountAdded: z.number().optional(),
      leafCountRequested: z.number().optional(),
    })
    .passthrough(),
});

export const playlistDetailResponseSchema = z.object({
  MediaContainer: z.object({
    size: z.number().optional(),
    Metadata: z.array(playlistDetailSchema).optional(),
  }),
});

export const playlistContentsResponseSchema = z.object({
  MediaContainer: z.object({
    size: z.number(),
    totalSize: z.number().optional(),
    offset: z.number().optional(),
    Metadata: z.array(playlistItemSchema).optional(),
  }),
});

export const playlistProviderAccessResponseSchema = z.object({
  MediaContainer: z.object({
    MediaProvider: z.array(
      z.object({
        identifier: z.string(),
        Feature: z.array(
          z.object({
            type: z.string(),
            readonly: z.boolean().optional(),
          }),
        ),
      }),
    ),
  }),
});

export type Playlist = z.infer<typeof playlistSchema>;
export type PlaylistDetail = z.infer<typeof playlistDetailSchema>;
export type PlaylistItem = z.infer<typeof playlistItemSchema>;
export type PlaylistsResponse = z.infer<typeof playlistsResponseSchema>;
export type PlaylistContentsResponse = z.infer<typeof playlistContentsResponseSchema>;

export const publicPlaylistSummarySchema = z.object({
  ratingKey: z.string(),
  title: z.string(),
  type: z.string(),
  smart: z.boolean(),
  playlistType: z.enum(playlistTypes).optional(),
  leafCount: z.number(),
  duration: z.number().optional(),
  composite: z.string().optional(),
});

export const publicPlaylistDetailSchema = publicPlaylistSummarySchema.extend({
  summary: z.string().optional(),
  readOnly: z.boolean(),
});

export const publicPlaylistItemSchema = playlistItemSchema;

export type PublicPlaylistSummary = z.infer<typeof publicPlaylistSummarySchema>;
export type PublicPlaylistDetail = z.infer<typeof publicPlaylistDetailSchema>;
export type PublicPlaylistItem = z.infer<typeof publicPlaylistItemSchema>;

export function toPublicPlaylistSummary(playlist: Playlist): PublicPlaylistSummary {
  return publicPlaylistSummarySchema.parse({
    ratingKey: playlist.ratingKey,
    title: playlist.title,
    type: playlist.type,
    smart: playlist.smart ?? false,
    playlistType: playlist.playlistType,
    leafCount: playlist.leafCount ?? 0,
    duration: playlist.duration,
    composite: playlist.composite,
  });
}

export function toPublicPlaylistDetail(
  playlist: PlaylistDetail,
  readOnly: boolean,
): PublicPlaylistDetail {
  return publicPlaylistDetailSchema.parse({
    ...toPublicPlaylistSummary(playlist),
    summary: playlist.summary,
    readOnly,
  });
}

export function toPublicPlaylistItem(item: PlaylistItem): PublicPlaylistItem {
  return publicPlaylistItemSchema.parse(item);
}

/** Map a library item's `type` to the playlist bucket it can live in. */
export function getPlaylistTypeForItemType(itemType: string): PlaylistType {
  switch (itemType) {
    case "track":
    case "album":
    case "artist":
      return "audio";
    case "photo":
    case "photoalbum":
      return "photo";
    default:
      // movie, episode, show, season, clip, etc. all live in video playlists.
      return "video";
  }
}
