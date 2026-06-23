import { z } from "zod";

/* ────────────────────────────────────────────────────────────
   Playlist Schemas
   Shapes for the playlist list / create / add-item endpoints used by
   the item details "Add to..." action.
   ──────────────────────────────────────────────────────────── */

/** The Plex `playlistType` of a playlist, which gates which items it accepts. */
export const playlistTypes = ["audio", "video", "photo"] as const;
export type PlaylistType = (typeof playlistTypes)[number];

/**
 * A single playlist as returned by `GET /playlists`. Plex includes far more
 * fields than the picker needs, so the schema stays lenient via `passthrough`.
 */
export const playlistSchema = z
  .object({
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
  })
  .passthrough();

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

export type Playlist = z.infer<typeof playlistSchema>;
export type PlaylistsResponse = z.infer<typeof playlistsResponseSchema>;

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
