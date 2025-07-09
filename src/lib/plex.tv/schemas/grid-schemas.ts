import { z } from "zod";

/* ────────────────────────────────────────────────────────────
   EPG Grid Schemas
   Schemas for Electronic Program Guide (EPG) grid data
   ──────────────────────────────────────────────────────────── */

const gridMediaSchema = z.object({
  id: z.number(),
  duration: z.number(),
  audioChannels: z.number(),
  videoResolution: z.string(),
  channelCallSign: z.string(),
  channelIdentifier: z.string(),
  channelThumb: z.string(),
  channelTitle: z.string(),
  channelVcn: z.string(),
  protocol: z.string(),
  beginsAt: z.number(),
  endsAt: z.number(),
  channelID: z.number(),
  onAir: z.boolean().optional(),
});

const gridImageSchema = z.object({
  alt: z.string(),
  type: z.string(),
  url: z.string(),
});

const gridChannelSchema = z.object({
  id: z.number(),
  filter: z.string(),
  tag: z.string(),
});

const gridMetadataSchema = z.object({
  ratingKey: z.string(),
  key: z.string(),
  skipParent: z.boolean().optional(),
  grandparentRatingKey: z.string().optional(),
  guid: z.string(),
  parentGuid: z.string().optional(),
  grandparentGuid: z.string().optional(),
  type: z.string(),
  title: z.string(),
  titleSort: z.string().optional(),
  grandparentKey: z.string().optional(),
  grandparentTitle: z.string().optional(),
  parentTitle: z.string().optional(),
  contentRating: z.string().optional(),
  summary: z.string().optional(),
  index: z.number().optional(),
  parentIndex: z.number().optional(),
  grandparentThumb: z.string().optional(),
  duration: z.number(),
  addedAt: z.number(),
  onAir: z.boolean().optional(),
  Media: z.array(gridMediaSchema),
  Image: z.array(gridImageSchema).optional(),
  Channel: z.array(gridChannelSchema).optional(),
});

const gridResponseSchema = z.object({
  MediaContainer: z.object({
    size: z.number(),
    Metadata: z.array(gridMetadataSchema),
  }),
});

// Types exported from schemas
export type GridMedia = z.infer<typeof gridMediaSchema>;
export type GridImage = z.infer<typeof gridImageSchema>;
export type GridChannel = z.infer<typeof gridChannelSchema>;
export type GridMetadata = z.infer<typeof gridMetadataSchema>;
export type GridResponse = z.infer<typeof gridResponseSchema>;

// Request parameters type
export type GridParams = {
  channelGridKey: string;
  date: string; // Format: YYYY-MM-DD
};

const channelSchema = z.object({
  id: z.string(),
  gridKey: z.string(),
  vcn: z.string(),
  thumb: z.string(),
  title: z.string(),
  callSign: z.string(),
});

const channelsResponseSchema = z.object({
  MediaContainer: z.object({
    size: z.number(),
    Channel: z.array(channelSchema),
  }),
});

// Additional types for channels
export type Channel = z.infer<typeof channelSchema>;
export type ChannelsResponse = z.infer<typeof channelsResponseSchema>;

// Export the schemas for use in client
export { gridResponseSchema, channelsResponseSchema }; 