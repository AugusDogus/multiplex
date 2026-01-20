import { z } from "zod";

// Metadata schema for media results (movies, TV shows, music, etc.)
const SearchResultMetadata = z
  .object({
    librarySectionTitle: z.string(),
    ratingKey: z.string(),
    key: z.string(),
    guid: z.string(),
    type: z.enum([
      "movie",
      "show",
      "episode",
      "artist",
      "album",
      "track",
      "person",
      "collection",
    ]),
    title: z.string(),
    titleSort: z.string().optional(),
    summary: z.string().optional(),
    year: z.number().optional(),
    thumb: z.string().optional(),
    art: z.string().optional(),
    duration: z.number().optional(),
    addedAt: z.number().optional(),
    updatedAt: z.number().optional(),
    studio: z.string().optional(),
    contentRating: z.string().optional(),
    rating: z.number().optional(),
    audienceRating: z.number().optional(),
    // TV Show specific fields
    parentRatingKey: z.string().optional(),
    grandparentRatingKey: z.string().optional(),
    parentTitle: z.string().optional(),
    grandparentTitle: z.string().optional(),
    index: z.number().optional(),
    parentIndex: z.number().optional(),
    // Music specific fields
    parentThumb: z.string().optional(),
    grandparentThumb: z.string().optional(),
    grandparentArt: z.string().optional(),
  })
  .passthrough();

// Directory schema for people/actor results
const SearchResultDirectory = z
  .object({
    key: z.string(),
    librarySectionID: z.number().optional(),
    librarySectionKey: z.string().optional(),
    librarySectionTitle: z.string().optional(),
    librarySectionType: z.number().optional(),
    type: z.string(),
    id: z.number().optional(),
    filter: z.string().optional(),
    tag: z.string(),
    tagType: z.number().optional(),
    tagKey: z.string().optional(),
    thumb: z.string().optional(),
    count: z.number().optional(),
  })
  .passthrough();

// Base search result with score
const BaseSearchResult = z.object({
  score: z.number(),
});

// Metadata search result
const MetadataSearchResult = BaseSearchResult.extend({
  Metadata: SearchResultMetadata,
});

// Directory search result
const DirectorySearchResult = BaseSearchResult.extend({
  Directory: SearchResultDirectory,
});

// Union of both result types
const SearchResult = z.union([MetadataSearchResult, DirectorySearchResult]);

export const searchResponseSchema = z.object({
  MediaContainer: z.object({
    size: z.number(),
    allowSync: z.boolean().optional(),
    identifier: z.string().optional(),
    librarySectionID: z.number().optional(),
    librarySectionTitle: z.string().optional(),
    librarySectionUUID: z.string().optional(),
    mediaTagPrefix: z.string().optional(),
    mediaTagVersion: z.number().optional(),
    nocache: z.boolean().optional(),
    SearchResult: z.array(SearchResult).optional(),
  }),
});

// Type guards for search results
export function isMetadataResult(
  result: z.infer<typeof SearchResult>,
): result is z.infer<typeof MetadataSearchResult> {
  return "Metadata" in result;
}

export function isDirectoryResult(
  result: z.infer<typeof SearchResult>,
): result is z.infer<typeof DirectorySearchResult> {
  return "Directory" in result;
}

// Search parameters schema
export const searchParamsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().default(100),
  searchTypes: z
    .array(z.enum(["movies", "tv", "music", "people"]))
    .default(["movies", "music", "people", "tv"]),
  includeCollections: z.boolean().default(true),
  includeExternalMedia: z.boolean().default(true),
});

// Processed search result type for frontend use
export const processedSearchResultSchema = z.object({
  ratingKey: z.string(),
  key: z.string(),
  guid: z.string(),
  type: z.enum([
    "movie",
    "show",
    "episode",
    "artist",
    "album",
    "track",
    "person",
    "collection",
  ]),
  title: z.string(),
  summary: z.string().optional(),
  year: z.number().optional(),
  thumb: z.string().optional(),
  art: z.string().optional(),
  duration: z.number().optional(),
  studio: z.string().optional(),
  contentRating: z.string().optional(),
  rating: z.number().optional(),
  score: z.number(),
  serverId: z.string(),
  serverName: z.string(),
  serverUrl: z.string().optional(),
  authToken: z.string().optional(),
  librarySection: z.string(),
  // TV Show specific fields
  parentTitle: z.string().optional(),
  grandparentTitle: z.string().optional(),
  seasonNumber: z.number().optional(),
  episodeNumber: z.number().optional(),
  // Music specific fields
  artistName: z.string().optional(),
  albumName: z.string().optional(),
});

export const groupedSearchResultsSchema = z.object({
  movies: z.array(processedSearchResultSchema),
  tv: z.array(processedSearchResultSchema),
  music: z.array(processedSearchResultSchema),
  people: z.array(processedSearchResultSchema),
  collections: z.array(processedSearchResultSchema),
  totalResults: z.number(),
});

// Export types
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type SearchParams = z.infer<typeof searchParamsSchema>;
export type ProcessedSearchResult = z.infer<typeof processedSearchResultSchema>;
export type GroupedSearchResults = z.infer<typeof groupedSearchResultsSchema>;
