import { z } from "zod";

// Simple schema that matches the raw Plex API response
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
    SearchResult: z.array(z.any()).optional(),
  }),
});

// Search parameters schema
export const searchParamsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().default(100),
  searchTypes: z.array(z.enum(['movies', 'tv', 'music', 'people'])).default(['movies', 'music', 'people', 'tv']),
  includeCollections: z.boolean().default(true),
  includeExternalMedia: z.boolean().default(true),
});

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
export type SearchResponse = z.infer<typeof searchResponseSchema>;
export type SearchParams = z.infer<typeof searchParamsSchema>;
export type ProcessedSearchResult = z.infer<typeof processedSearchResultSchema>;
export type GroupedSearchResults = z.infer<typeof groupedSearchResultsSchema>;