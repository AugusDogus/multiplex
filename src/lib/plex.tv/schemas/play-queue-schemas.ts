import { z } from "zod";

/* ────────────────────────────────────────────────────────────
   Play Queue Schemas
   Schemas for Plex play queue responses with markers support
   ──────────────────────────────────────────────────────────── */

/**
 * Schema for individual markers (intro, credits, commercial)
 */
export const markerSchema = z.object({
  type: z.enum(['intro', 'credits', 'commercial']),
  startTimeOffset: z.number(),
  endTimeOffset: z.number(),
});

/**
 * Schema for play queue items with optional markers
 */
export const playQueueItemSchema = z.object({
  ratingKey: z.string(),
  key: z.string(),
  guid: z.string(),
  type: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  thumb: z.string().optional(),
  art: z.string().optional(),
  duration: z.number().optional(),
  addedAt: z.number().optional(),
  updatedAt: z.number().optional(),
  playQueueItemID: z.number().optional(),
  // TV Show specific fields
  parentRatingKey: z.string().optional(),
  grandparentRatingKey: z.string().optional(),
  parentTitle: z.string().optional(),
  grandparentTitle: z.string().optional(),
  index: z.number().optional(),
  parentIndex: z.number().optional(),
  // Markers array for skip intro/credits functionality
  Marker: z.array(markerSchema).optional(),
}).passthrough();

/**
 * Schema for play queue response from Plex server
 */
export const playQueueResponseSchema = z.object({
  MediaContainer: z.object({
    playQueueID: z.number(),
    playQueueVersion: z.number().optional(),
    playQueueTotalCount: z.number().optional(),
    playQueueSelectedItemID: z.number().optional(),
    playQueueSelectedItemOffset: z.number().optional(),
    playQueueSelectedMetadataItemID: z.string().optional(),
    playQueueShuffled: z.boolean().optional(),
    size: z.number().optional(),
    identifier: z.string().optional(),
    mediaTagPrefix: z.string().optional(),
    mediaTagVersion: z.number().optional(),
    Metadata: z.array(playQueueItemSchema).optional(),
  }),
});

/**
 * Schema for create play queue parameters
 */
export const createPlayQueueParamsSchema = z.object({
  type: z.enum(['video', 'audio']),
  uri: z.string(),
  continuous: z.boolean().default(true),
  includeMarkers: z.boolean().default(true),
  includeChapters: z.boolean().default(true),
  shuffle: z.boolean().default(false),
  repeat: z.number().default(0),
});

// Export types
export type Marker = z.infer<typeof markerSchema>;
export type PlayQueueItem = z.infer<typeof playQueueItemSchema>;
export type PlayQueueResponse = z.infer<typeof playQueueResponseSchema>;
export type CreatePlayQueueParams = z.infer<typeof createPlayQueueParamsSchema>;