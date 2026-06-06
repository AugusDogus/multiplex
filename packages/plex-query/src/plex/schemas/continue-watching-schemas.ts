import { z } from "zod";

/* ────────────────────────────────────────────────────────────
   Continue Watching Schemas
   Schemas specific to Continue Watching functionality
   ──────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────
   1. Utility types & transformers
   ──────────────────────────────────────────────────────────── */

const UnixSeconds = z
  .number()
  .int()
  .nonnegative()
  .transform((n) => new Date(n * 1000));

const StreamType = z.number(); // 1 = video, 2 = audio, 3 = subtitle

export const knownImageTypes = [
  "coverPoster",
  "snapshot",
  "background",
  "backgroundSquare",
  "clearLogo",
  "banner",
  "keyart",
] as const;

export type KnownImageType = (typeof knownImageTypes)[number];
export type ImageType = KnownImageType | (string & {});

/* ────────────────────────────────────────────────────────────
   2. Building blocks
   ──────────────────────────────────────────────────────────── */

const Image = z
  .object({
    alt: z.string(),
    type: z.string() as z.ZodType<ImageType>,
    url: z.string(),
  })
  .passthrough();

const UltraBlurColors = z.object({
  topLeft: z.string(),
  topRight: z.string(),
  bottomRight: z.string(),
  bottomLeft: z.string(),
});

const Guid = z.object({
  id: z.string(),
});

const Rating = z.object({
  image: z.string(),
  value: z.number(),
  type: z.string(),
});

const Credit = z.object({
  id: z.number().optional(),
  filter: z.string().optional(),
  tag: z.string(),
  tagKey: z.string().optional(),
  role: z.string().optional(),
  thumb: z.string().optional(),
});

const Genre = z.object({
  tag: z.string(),
});

const Country = z.object({
  tag: z.string(),
});

/* ────────────────────────────────────────────────────────────
   3. Streams (discriminated by streamType)
   ──────────────────────────────────────────────────────────── */

const BaseStream = z.object({
  id: z.number(),
  streamType: StreamType,
  codec: z.string(),
  index: z.number(),
  bitrate: z.number().optional(),
  displayTitle: z.string(),
  extendedDisplayTitle: z.string(),
  language: z.string().optional(),
  languageTag: z.string().optional(),
  languageCode: z.string().optional(),
  streamIdentifier: z.string().optional(),
});

const VideoStream = BaseStream.extend({
  streamType: z.literal(1),
  default: z.boolean().optional(),
  bitDepth: z.number(),
  chromaLocation: z.string().optional(),
  chromaSubsampling: z.string().optional(),
  codedHeight: z.number().optional(),
  codedWidth: z.number().optional(),
  colorPrimaries: z.string().optional(),
  colorRange: z.string().optional(),
  colorSpace: z.string().optional(),
  colorTrc: z.string().optional(),
  frameRate: z.number(),
  hasScalingMatrix: z.boolean().optional(),
  height: z.number(),
  level: z.number().optional(),
  profile: z.string().optional(),
  refFrames: z.number().optional(),
  scanType: z.string().optional(),
  width: z.number(),
});

const AudioStream = BaseStream.extend({
  streamType: z.literal(2),
  selected: z.boolean().optional(),
  default: z.boolean().optional(),
  channels: z.number(),
  audioChannelLayout: z.string().optional(),
  profile: z.string().optional(),
  samplingRate: z.number().optional(),
  title: z.string().optional(),
});

const SubtitleStream = BaseStream.extend({
  streamType: z.literal(3),
  // External subtitle streams from Plex can be selectable by `id` while
  // omitting `index`; don't reject the full metadata response for those.
  index: z.number().optional(),
  key: z.string().optional(),
  format: z.string().optional(),
  selected: z.boolean().optional(),
  canAutoSync: z.boolean().optional(),
  default: z.boolean().optional(),
  hearingImpaired: z.boolean().optional(),
  title: z.string().optional(),
  captions: z.boolean().optional(),
  dub: z.boolean().optional(),
});

export const Stream = z.discriminatedUnion("streamType", [
  VideoStream,
  AudioStream,
  SubtitleStream,
]);

/* ────────────────────────────────────────────────────────────
   4. Media & Parts
   ──────────────────────────────────────────────────────────── */

const Part = z.object({
  id: z.number(),
  key: z.string(),
  duration: z.number(),
  file: z.string(),
  size: z.number(),
  container: z.string(),
  videoProfile: z.string().optional(),
  audioProfile: z.string().optional(),
  has64bitOffsets: z.boolean().optional(),
  optimizedForStreaming: z.boolean().optional(),
  indexes: z.string().optional(),
  Stream: z.array(Stream).optional(),
});

const Media = z.object({
  id: z.number(),
  duration: z.number(),
  bitrate: z.number(),
  width: z.number(),
  height: z.number(),
  aspectRatio: z.number(),
  audioChannels: z.number(),
  audioCodec: z.string(),
  videoCodec: z.string(),
  videoResolution: z.string(),
  container: z.string(),
  videoFrameRate: z.string(),
  optimizedForStreaming: z.number().optional(),
  audioProfile: z.string().optional(),
  has64bitOffsets: z.boolean().optional(),
  videoProfile: z.string().optional(),
  hasVoiceActivity: z.boolean().optional(),
  Part: z.array(Part),
});

/* ────────────────────────────────────────────────────────────
   5. Continue Watching Metadata
   ──────────────────────────────────────────────────────────── */

export const ContinueWatchingMetadata = z.object({
  ratingKey: z.string(),
  key: z.string(),
  guid: z.string(),
  slug: z.string().optional(),
  studio: z.string().optional(),
  type: z.string(), // "episode", "movie", "show", etc.
  title: z.string(),
  titleSort: z.string().optional(),

  // Hierarchy fields for episodes
  parentRatingKey: z.string().optional(),
  grandparentRatingKey: z.string().optional(),
  parentGuid: z.string().optional(),
  grandparentGuid: z.string().optional(),
  grandparentSlug: z.string().optional(),
  grandparentKey: z.string().optional(),
  parentKey: z.string().optional(),
  grandparentTitle: z.string().optional(), // Show title for episodes
  parentTitle: z.string().optional(), // Season title for episodes

  // Library info
  librarySectionTitle: z.string(),
  librarySectionID: z.number(),
  librarySectionKey: z.string(),

  // Content info
  contentRating: z.string().optional(),
  index: z.number().optional(), // Episode number
  parentIndex: z.number().optional(), // Season number
  rating: z.number().optional(),
  audienceRating: z.number().optional(),

  // Viewing info
  viewOffset: z.number().optional(), // Current playback position
  viewCount: z.number().optional(), // Number of times watched
  skipCount: z.number().optional(),
  lastViewedAt: UnixSeconds.optional(),
  includedAt: UnixSeconds.optional(),

  // Metadata
  year: z.number().optional(),
  tagline: z.string().optional(),
  summary: z.string().optional(),
  thumb: z.string().optional(),
  art: z.string().optional(),
  parentThumb: z.string().optional(),
  grandparentThumb: z.string().optional(),
  grandparentArt: z.string().optional(),
  grandparentTheme: z.string().optional(),
  duration: z.number().optional(),
  originallyAvailableAt: z.string().optional(),
  addedAt: UnixSeconds.optional(),
  updatedAt: UnixSeconds.optional(),
  audienceRatingImage: z.string().optional(),
  chapterSource: z.string().optional(),

  // Rich metadata
  Media: z.array(Media).optional(),
  Image: z.array(Image).optional(),
  UltraBlurColors: UltraBlurColors.optional(),
  Guid: z.array(Guid).optional(),
  Rating: z.array(Rating).optional(),
  Genre: z.array(Genre).optional(),
  Country: z.array(Country).optional(),
  Director: z.array(Credit).optional(),
  Writer: z.array(Credit).optional(),
  Role: z.array(Credit).optional(),
  Producer: z.array(Credit).optional(),
});

/* ────────────────────────────────────────────────────────────
   6. Hub & Container
   ──────────────────────────────────────────────────────────── */

export const ContinueWatchingHub = z.object({
  hubKey: z.string().optional(),
  key: z.string(),
  title: z.string(),
  type: z.string(),
  hubIdentifier: z.string(),
  context: z.string().optional(),
  size: z.number(),
  more: z.boolean().optional(),
  style: z.string().optional(),
  Metadata: z.array(ContinueWatchingMetadata),
});

export const ContinueWatchingContainer = z.object({
  MediaContainer: z.object({
    size: z.number(),
    allowSync: z.boolean(),
    identifier: z.string(),
    Hub: z.array(ContinueWatchingHub),
  }),
});

/**
 * Response shape for the `/library/metadata/{ratingKey}` endpoint. Returns
 * a single item's metadata including expanded `Media[].Part[].Stream[]`
 * data that `hubs/continueWatching` omits.
 */
export const itemMetadataResponseSchema = z.object({
  MediaContainer: z.object({
    size: z.number().optional(),
    identifier: z.string().optional(),
    Metadata: z.array(ContinueWatchingMetadata).optional(),
  }),
});

/* ────────────────────────────────────────────────────────────
   7. Transformed types for easier consumption
   ──────────────────────────────────────────────────────────── */

// Transform the raw API response into something easier to work with
export const continueWatchingResponseSchema = ContinueWatchingContainer.transform((data) => {
  // Flatten all metadata items from all hubs
  const items = data.MediaContainer.Hub.flatMap((hub) =>
    hub.Metadata.map((metadata) => ({
      ...metadata,
      hubTitle: hub.title,
      hubType: hub.type,
      serverId: data.MediaContainer.identifier,
      // Computed progress fields
      progressPercent:
        metadata.viewOffset && metadata.duration
          ? Math.round((metadata.viewOffset / metadata.duration) * 100)
          : undefined,
      isCompleted:
        metadata.viewOffset && metadata.duration
          ? metadata.viewOffset >= metadata.duration * 0.9 // 90% watched = completed
          : false,
      timeRemaining:
        metadata.viewOffset && metadata.duration
          ? metadata.duration - metadata.viewOffset
          : undefined,
    })),
  );

  return {
    serverId: data.MediaContainer.identifier,
    totalSize: data.MediaContainer.size,
    allowSync: data.MediaContainer.allowSync,
    hubs: data.MediaContainer.Hub,
    items,
  };
});

/* ────────────────────────────────────────────────────────────
   8. Export types
   ──────────────────────────────────────────────────────────── */

export type ContinueWatchingItem = z.infer<typeof ContinueWatchingMetadata> & {
  hubTitle: string;
  hubType: string;
  serverId: string;
  // Computed fields for UI
  progressPercent?: number;
  isCompleted?: boolean;
  timeRemaining?: number;
  progressColor?: "dark" | "light";
};

export type ContinueWatchingResponse = z.infer<typeof continueWatchingResponseSchema>;

export type ContinueWatchingHubType = z.infer<typeof ContinueWatchingHub>;

export type StreamType = z.infer<typeof Stream>;

export type ItemMetadata = z.infer<typeof ContinueWatchingMetadata>;

export type ItemMetadataResponse = z.infer<typeof itemMetadataResponseSchema>;

/* ────────────────────────────────────────────────────────────
   9. Type guards & utilities
   ──────────────────────────────────────────────────────────── */

export function isContinueWatchingResponse(data: unknown): data is ContinueWatchingResponse {
  return continueWatchingResponseSchema.safeParse(data).success;
}

export function hasViewOffset(
  item: ContinueWatchingItem,
): item is ContinueWatchingItem & { viewOffset: number } {
  return typeof item.viewOffset === "number" && item.viewOffset > 0;
}

export function isEpisode(item: ContinueWatchingItem): boolean {
  return item.type === "episode";
}

export function isMovie(item: ContinueWatchingItem): boolean {
  return item.type === "movie";
}
