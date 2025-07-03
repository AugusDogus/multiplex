import { z } from "zod";

export const searchResultMetadataSchema = z.object({
  librarySectionTitle: z.string(),
  ratingKey: z.string(),
  key: z.string(),
  guid: z.string(),
  type: z.enum(['movie', 'show', 'episode', 'artist', 'album', 'track', 'person', 'collection']),
  title: z.string(),
  titleSort: z.string().optional(),
  summary: z.string().optional(),
  year: z.number().optional(),
  thumb: z.string().optional(),
  art: z.string().optional(),
  duration: z.number().optional(),
  addedAt: z.number().optional(),
  updatedAt: z.number().optional(),
  leafCount: z.number().optional(),
  viewedLeafCount: z.number().optional(),
  childCount: z.number().optional(),
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
  // Collection specific fields
  collectionMode: z.string().optional(),
  collectionSort: z.string().optional(),
}).passthrough();

export const searchResultSchema = z.object({
  score: z.number(),
  Metadata: searchResultMetadataSchema,
});

export const searchResponseSchema = z.preprocess(
  (data: any) => {
    // Ensure SearchResult is always an array
    if (data && data.MediaContainer && !data.MediaContainer.SearchResult) {
      data.MediaContainer.SearchResult = [];
    }
    return data;
  },
  z.object({
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
      SearchResult: z.array(searchResultSchema),
    }),
  })
);

// Processed search result type for frontend use
export const processedSearchResultSchema = z.object({
  ratingKey: z.string(),
  key: z.string(),
  guid: z.string(),
  type: z.enum(['movie', 'show', 'episode', 'artist', 'album', 'track', 'person', 'collection']),
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
export type SearchResultMetadata = z.infer<typeof searchResultMetadataSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type ProcessedSearchResult = z.infer<typeof processedSearchResultSchema>;
export type GroupedSearchResults = z.infer<typeof groupedSearchResultsSchema>;

// Search parameters schema
export const searchParamsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().default(100),
  searchTypes: z.array(z.enum(['movies', 'tv', 'music', 'people'])).default(['movies', 'tv', 'music']),
  includeCollections: z.boolean().default(true),
  includeExternalMedia: z.boolean().default(true),
});

export type SearchParams = z.infer<typeof searchParamsSchema>;