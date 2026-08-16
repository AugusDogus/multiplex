import type { LibraryPivotId } from "@multiplex/plex-query";

/**
 * Library pivots (tabs) Multiplex renders, in Plex's display order. Kept in a
 * non-client module so both the server page and the client tab bar can import
 * them without dragging a client boundary across the server component.
 */
export const SUPPORTED_PIVOT_LABELS = {
  recommended: "Recommended",
  library: "Library",
  collections: "Collections",
  categories: "Categories",
  playlists: "Playlists",
} satisfies Record<LibraryPivotId, string>;

export const SUPPORTED_PIVOT_IDS = [
  "recommended",
  "library",
  "collections",
  "categories",
  "playlists",
] satisfies ReadonlyArray<LibraryPivotId>;

export function isSupportedPivot(id: string): id is LibraryPivotId {
  return Object.prototype.hasOwnProperty.call(SUPPORTED_PIVOT_LABELS, id);
}
