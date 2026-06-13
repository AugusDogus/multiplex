import { z } from "zod";

/* ────────────────────────────────────────────────────────────
   Library Browse Schemas
   Filter/sort metadata, categories, and filter values used to drive
   the Library tab's type/filter/sort dropdown menus.
   ──────────────────────────────────────────────────────────── */

/** A single filter offered for a content type (e.g. Genre, Year, Unwatched). */
export const LibraryFilterSchema = z.object({
  filter: z.string(),
  filterType: z.string(),
  key: z.string(),
  title: z.string(),
  type: z.string(),
});

/** A single sort option offered for a content type (e.g. Title, Date Added). */
export const LibrarySortSchema = z.object({
  key: z.string(),
  title: z.string(),
  default: z.string().optional(),
  defaultDirection: z.string().optional(),
  descKey: z.string().optional(),
  firstCharacterKey: z.string().optional(),
  active: z.boolean().optional(),
  activeDirection: z.string().optional(),
});

/**
 * A browsable content type within a library section. Movie libraries expose
 * `Movies`/`Folders`; show libraries expose `TV Shows`/`Seasons`/`Episodes`/`Folders`.
 */
export const LibraryTypeSchema = z
  .object({
    key: z.string(),
    type: z.string(),
    title: z.string(),
    active: z.boolean().optional(),
    Filter: z.array(LibraryFilterSchema).optional().default([]),
    Sort: z.array(LibrarySortSchema).optional().default([]),
  })
  .passthrough();

export const libraryMetaResponseSchema = z
  .object({
    MediaContainer: z
      .object({
        librarySectionID: z.number().optional(),
        librarySectionTitle: z.string().optional(),
        Meta: z
          .object({
            Type: z.array(LibraryTypeSchema).optional().default([]),
          })
          .optional(),
      })
      .passthrough(),
  })
  .transform((data) => ({
    librarySectionID: data.MediaContainer.librarySectionID,
    librarySectionTitle: data.MediaContainer.librarySectionTitle,
    types: data.MediaContainer.Meta?.Type ?? [],
  }));

/* ────────────────────────────────────────────────────────────
   Categories (genre/tag tiles)
   ──────────────────────────────────────────────────────────── */

export const CategoryDirectorySchema = z
  .object({
    key: z.string(),
    title: z.string(),
    type: z.string().optional(),
    thumb: z.string().optional(),
    art: z.string().optional(),
  })
  .passthrough();

export const categoriesResponseSchema = z
  .object({
    MediaContainer: z
      .object({
        size: z.number(),
        totalSize: z.number().optional(),
        offset: z.number().optional(),
        title1: z.string().optional(),
        Directory: z.array(CategoryDirectorySchema).optional().default([]),
      })
      .passthrough(),
  })
  .transform((data) => ({
    categories: data.MediaContainer.Directory,
    size: data.MediaContainer.size,
    totalSize: data.MediaContainer.totalSize ?? data.MediaContainer.size,
    offset: data.MediaContainer.offset ?? 0,
  }));

/* ────────────────────────────────────────────────────────────
   Filter values (e.g. the list of genres for the Genre filter)
   ──────────────────────────────────────────────────────────── */

export const FilterValueSchema = z
  .object({
    key: z.string(),
    title: z.string(),
    fastKey: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

export const filterValuesResponseSchema = z
  .object({
    MediaContainer: z
      .object({
        size: z.number(),
        totalSize: z.number().optional(),
        offset: z.number().optional(),
        Directory: z.array(FilterValueSchema).optional().default([]),
      })
      .passthrough(),
  })
  .transform((data) => ({
    values: data.MediaContainer.Directory,
    size: data.MediaContainer.size,
    totalSize: data.MediaContainer.totalSize ?? data.MediaContainer.size,
    offset: data.MediaContainer.offset ?? 0,
  }));

export type LibraryFilter = z.infer<typeof LibraryFilterSchema>;
export type LibrarySort = z.infer<typeof LibrarySortSchema>;
export type LibraryType = z.infer<typeof LibraryTypeSchema>;
export type LibraryMetaResponse = z.infer<typeof libraryMetaResponseSchema>;
export type CategoryDirectory = z.infer<typeof CategoryDirectorySchema>;
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>;
export type FilterValue = z.infer<typeof FilterValueSchema>;
export type FilterValuesResponse = z.infer<typeof filterValuesResponseSchema>;

export type CategoryWithServer = CategoryDirectory & {
  serverId: string;
  serverUrl?: string;
  authToken?: string;
};

/* ────────────────────────────────────────────────────────────
   Library pivots (tabs) derived from /media/providers
   ──────────────────────────────────────────────────────────── */

export type LibraryPivotId = "recommended" | "library" | "collections" | "categories" | "playlists";

export interface LibraryPivot {
  id: string;
  type: string;
  key: string;
  title: string;
  symbol?: string;
  context?: string;
}
