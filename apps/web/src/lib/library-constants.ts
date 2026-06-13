/**
 * Library pivots (tabs) Multiplex renders, in Plex's display order. Kept in a
 * non-client module so both the server page and the client tab bar can import
 * them without dragging a client boundary across the server component.
 */
export const SUPPORTED_PIVOT_LABELS: Record<string, string> = {
  recommended: "Recommended",
  library: "Library",
  collections: "Collections",
  categories: "Categories",
  playlists: "Playlists",
};

export const SUPPORTED_PIVOT_IDS: string[] = Object.keys(
  SUPPORTED_PIVOT_LABELS,
);
