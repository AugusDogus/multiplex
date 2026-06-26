import type {
  EnrichedItemMetadataChild,
  ItemMetadata,
  ItemMetadataChild,
  LibrarySectionFields,
  PlayableEnrichedChild,
  PlayableMetadata,
} from "../schemas/continue-watching-schemas";

const LIBRARY_ITEM_URI_PATTERN =
  /^server:\/\/(?<serverId>[^/]+)\/com\.plexapp\.plugins\.library\/library\/metadata\/(?<ratingKey>[^/?#]+)/;

export interface LibraryItemUriParts {
  serverId: string;
  ratingKey: string;
}

/* ────────────────────────────────────────────────────────────
   Metadata utilities for item details and hierarchy navigation
   ──────────────────────────────────────────────────────────── */

/**
 * Build the `server://` source URI Plex uses to reference a library item when
 * mutating play queues and playlists. `key` is preferred when it already points
 * at a metadata path; otherwise it is derived from the `ratingKey`.
 */
export function buildLibraryItemUri(serverId: string, ratingKey: string, key?: string): string {
  const itemKey = key && key.startsWith("/") ? key : `/library/metadata/${ratingKey}`;
  return `server://${serverId}/com.plexapp.plugins.library${itemKey}`;
}

export function parseLibraryItemUri(sourceUri: string): LibraryItemUriParts | null {
  const match = LIBRARY_ITEM_URI_PATTERN.exec(sourceUri);
  if (!match?.groups?.serverId || !match.groups.ratingKey) {
    return null;
  }

  return {
    serverId: match.groups.serverId,
    ratingKey: match.groups.ratingKey,
  };
}

export function enrichMetadataChildren(
  children: ItemMetadataChild[],
  parent: LibrarySectionFields,
): EnrichedItemMetadataChild[] {
  return children.map((child) => ({
    ...child,
    librarySectionTitle: child.librarySectionTitle ?? parent.librarySectionTitle,
    librarySectionID: child.librarySectionID ?? parent.librarySectionID,
    librarySectionKey: child.librarySectionKey ?? parent.librarySectionKey,
  }));
}

function getStreamPartKey(metadata: Pick<ItemMetadata, "Media">): string | undefined {
  return metadata.Media?.[0]?.Part?.[0]?.key;
}

export function getPlayableChildren(
  children: EnrichedItemMetadataChild[],
): PlayableEnrichedChild[] {
  const playable: PlayableEnrichedChild[] = [];

  for (const child of children) {
    const streamPartKey = getStreamPartKey(child);
    if (streamPartKey) {
      playable.push({ ...child, streamPartKey });
    }
  }

  return playable;
}

export function toPlayableMetadata(item: ItemMetadata): PlayableMetadata | null {
  const streamPartKey = getStreamPartKey(item);
  if (!streamPartKey) {
    return null;
  }

  return { ...item, streamPartKey };
}

const PLAYABLE_POSTER_ITEM_TYPES = new Set(["movie", "episode", "show", "season"]);

/** Whether a browse/hub poster can offer direct playback (vs. opening a collection/playlist). */
export function isPlayablePosterItemType(type: string): boolean {
  return PLAYABLE_POSTER_ITEM_TYPES.has(type);
}

export function resolvePlayTarget(
  item: ItemMetadata,
  playableChildren: PlayableEnrichedChild[],
): PlayableMetadata | null {
  const itemPlayable = toPlayableMetadata(item);
  if (itemPlayable) {
    return itemPlayable;
  }

  if (item.type === "season") {
    // Plex returns season children in episode order; first playable is the season play target.
    return getFirstPlayableChild(playableChildren);
  }

  return null;
}

function getFirstPlayableChild(playableChildren: PlayableEnrichedChild[]): PlayableMetadata | null {
  return playableChildren[0] ?? null;
}

export function getDetailsSecondaryTitle(item: ItemMetadata): string | undefined {
  if (item.type === "episode" || item.type === "season") {
    return item.title;
  }

  return undefined;
}

export function getMetadataTypeLabel(type: string): string {
  switch (type) {
    case "movie":
      return "Movie";
    case "show":
      return "TV Show";
    case "episode":
      return "Episode";
    case "season":
      return "Season";
    case "artist":
      return "Artist";
    case "album":
      return "Album";
    case "track":
      return "Track";
    case "person":
      return "Person";
    case "collection":
      return "Collection";
    default:
      return type;
  }
}

export function formatMetadataDuration(durationMs: number | undefined) {
  if (!durationMs) {
    return undefined;
  }

  const totalMinutes = Math.round(durationMs / 1000 / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes}min`;
  }

  return minutes === 0 ? `${hours}hr` : `${hours}hr ${minutes}min`;
}

export function formatSeasonCount(count: number | undefined) {
  if (!count) {
    return undefined;
  }

  return `${count} season${count === 1 ? "" : "s"}`;
}

export function formatEpisodeCount(count: number | undefined) {
  if (!count) {
    return undefined;
  }

  return `${count} episode${count === 1 ? "" : "s"}`;
}

export function getSeasonEpisodeIndices(
  parentIndex: number | undefined,
  index: number | undefined,
): { season: number; episode: number } | undefined {
  if (parentIndex === undefined || index === undefined) {
    return undefined;
  }

  return { season: parentIndex, episode: index };
}

export function formatEpisodeLabel(index: number | undefined): string | undefined {
  if (index === undefined) {
    return undefined;
  }

  return `Episode ${index}`;
}

export function formatSeasonEpisodeLabel(
  parentIndex: number | undefined,
  index: number | undefined,
): string | undefined {
  const indices = getSeasonEpisodeIndices(parentIndex, index);
  if (!indices) {
    return undefined;
  }

  return `S${indices.season} · E${indices.episode}`;
}

export function formatEpisodeListLabel(item: Pick<ItemMetadata, "index" | "duration">) {
  const episode = formatEpisodeLabel(item.index);
  const duration = formatMetadataDuration(item.duration);

  if (episode && duration) {
    return `${episode} • ${duration}`;
  }

  if (episode) {
    return episode;
  }

  return duration ?? "";
}

export function getMetadataSummaryLines(item: ItemMetadata): string[] {
  if (item.type === "show") {
    return [
      item.year?.toString(),
      formatSeasonCount(item.childCount),
      formatEpisodeCount(item.leafCount),
      item.contentRating,
    ].flatMap((value) => (value ? [value] : []));
  }

  if (item.type === "season") {
    return [formatEpisodeCount(item.leafCount)].flatMap((value) => (value ? [value] : []));
  }

  return [item.year?.toString(), formatMetadataDuration(item.duration), item.contentRating].flatMap(
    (value) => (value ? [value] : []),
  );
}

export function getProgressPercent(item: Pick<ItemMetadata, "viewOffset" | "duration">): number {
  if (!item.viewOffset || !item.duration) {
    return 0;
  }

  return Math.round((item.viewOffset / item.duration) * 100);
}

export function getWatchedPercent(
  item: Pick<ItemMetadata, "viewedLeafCount" | "leafCount">,
): number {
  if (!item.viewedLeafCount || !item.leafCount) {
    return 0;
  }

  return Math.min(Math.round((item.viewedLeafCount / item.leafCount) * 100), 100);
}

export function formatRemainingDuration(remainingMs: number, style: "compact" | "verbose"): string {
  if (remainingMs <= 0) {
    return "";
  }

  const minutes = Math.ceil(remainingMs / 1000 / 60);

  if (minutes < 60) {
    return style === "compact" ? `${minutes}m left` : `${minutes}min left`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (remainingMinutes === 0) {
    return style === "compact" ? `${hours}h left` : `${hours}hr left`;
  }

  return style === "compact"
    ? `${hours}h ${remainingMinutes}m left`
    : `${hours}hr ${remainingMinutes}min left`;
}

export function formatDetailsTimeRemaining(item: Pick<ItemMetadata, "viewOffset" | "duration">) {
  if (!item.viewOffset || !item.duration || item.viewOffset >= item.duration) {
    return undefined;
  }

  const formatted = formatRemainingDuration(item.duration - item.viewOffset, "verbose");

  return formatted || undefined;
}

export function getRatingLabel(item: ItemMetadata): string | undefined {
  const rating = item.Rating?.[0]?.value ?? item.audienceRating ?? item.rating;

  if (!rating) {
    return undefined;
  }

  return rating <= 10 ? `${Math.round(rating * 10)}%` : `${Math.round(rating)}%`;
}

export function formatGenreSummary(genres: ItemMetadata["Genre"], limit = 3): string | undefined {
  if (!genres?.length) {
    return undefined;
  }

  const visibleTags = genres.slice(0, limit).map((genre) => genre.tag);
  const summary = visibleTags.join(", ");

  if (genres.length > visibleTags.length) {
    return `${summary}, and more`;
  }

  return summary;
}

export function formatDirectorList(directors: ItemMetadata["Director"]): string | undefined {
  const names = directors?.map((director) => director.tag) ?? [];
  if (names.length === 0) {
    return undefined;
  }

  return names.join(", ");
}

export function getPlayButtonLabel(
  playTarget: Pick<ItemMetadata, "viewOffset" | "duration"> | null | undefined,
): "Play" | "Resume" {
  if (!playTarget || getProgressPercent(playTarget) === 0) {
    return "Play";
  }

  return "Resume";
}

export type MetadataPosterInput = Pick<
  ItemMetadata,
  "type" | "thumb" | "grandparentThumb" | "parentThumb"
> & {
  /** Collections/playlists expose a mosaic poster here instead of `thumb`. */
  composite?: string;
  childCount?: number;
};

export function getPosterImagePath(item: MetadataPosterInput): string | undefined {
  if (item.type === "episode") {
    return item.grandparentThumb ?? item.thumb;
  }

  if (item.type === "season") {
    return item.parentThumb ?? item.thumb;
  }

  if (item.type === "playlist") {
    return item.composite ?? item.thumb;
  }

  if (item.type === "collection") {
    // An empty collection's composite poster renders nothing, so fall back to
    // the placeholder rather than requesting a broken image.
    if (item.childCount === 0 && item.thumb?.includes("/composite/")) {
      return undefined;
    }
    return item.thumb;
  }

  return item.thumb;
}

export function getSeasonPosterImagePath(
  season: Pick<ItemMetadata, "thumb" | "parentThumb">,
): string | undefined {
  return season.thumb ?? season.parentThumb;
}

export function getBackdropImagePath(item: ItemMetadata): string | undefined {
  return item.art ?? item.grandparentArt;
}

export function formatStreamCodec(codec: string) {
  if (codec.toLowerCase() === "h264") {
    return "H.264";
  }

  if (codec.toLowerCase() === "hevc") {
    return "HEVC";
  }

  return codec.toUpperCase();
}

/* ────────────────────────────────────────────────────────────
   Media Info (the "Get Info" modal)
   ──────────────────────────────────────────────────────────── */

export interface MediaInfoRow {
  label: string;
  value: string;
}

export interface MediaInfoStream {
  id: number;
  kind: "Video" | "Audio" | "Subtitle";
  title: string;
  rows: MediaInfoRow[];
}

export interface MediaInfoPart {
  id: number;
  file: string | undefined;
  rows: MediaInfoRow[];
  streams: MediaInfoStream[];
}

export interface MediaInfoVersion {
  id: number;
  label: string;
  rows: MediaInfoRow[];
  parts: MediaInfoPart[];
}

function rowsFrom(entries: [string, string | number | boolean | undefined][]): MediaInfoRow[] {
  return entries.flatMap(([label, value]) => {
    if (value === undefined || value === "") {
      return [];
    }

    return [{ label, value: typeof value === "boolean" ? (value ? "Yes" : "No") : String(value) }];
  });
}

/** Human-readable file size from a raw byte count (e.g. `1.4 GB`). */
export function formatFileSize(bytes: number | undefined): string | undefined {
  if (!bytes || bytes <= 0) {
    return undefined;
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);

  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/** Human-readable bitrate from a kilobit-per-second count (e.g. `8.2 Mbps`). */
export function formatBitrate(kbps: number | undefined): string | undefined {
  if (!kbps || kbps <= 0) {
    return undefined;
  }

  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} kbps`;
}

/**
 * Flatten an item's `Media[].Part[].Stream[]` into the structured sections the
 * Get Info modal renders. Returns an empty array for items without media (e.g.
 * shows/seasons), letting the caller hide the action.
 */
export function getMediaInfo(item: Pick<ItemMetadata, "Media">): MediaInfoVersion[] {
  const versions = item.Media ?? [];

  return versions.map((media, mediaIndex) => ({
    id: media.id,
    label: versions.length > 1 ? `Version ${mediaIndex + 1}` : "Media",
    rows: rowsFrom([
      ["Container", media.container?.toUpperCase()],
      [
        "Resolution",
        media.videoResolution
          ? `${media.videoResolution} (${media.width}×${media.height})`
          : undefined,
      ],
      ["Video codec", media.videoCodec ? formatStreamCodec(media.videoCodec) : undefined],
      ["Frame rate", media.videoFrameRate],
      ["Bitrate", formatBitrate(media.bitrate)],
      ["Audio codec", media.audioCodec ? formatStreamCodec(media.audioCodec) : undefined],
      ["Audio channels", media.audioChannels],
    ]),
    parts: media.Part.map((part) => ({
      id: part.id,
      file: part.file,
      // `Container` is already shown at the version level, so the part only
      // adds the file-specific size and duration.
      rows: rowsFrom([
        ["Size", formatFileSize(part.size)],
        ["Duration", formatMetadataDuration(part.duration)],
      ]),
      streams: (part.Stream ?? []).map((stream): MediaInfoStream => {
        if (stream.streamType === 1) {
          return {
            id: stream.id,
            kind: "Video",
            title: stream.extendedDisplayTitle || stream.displayTitle,
            rows: rowsFrom([
              ["Codec", formatStreamCodec(stream.codec)],
              ["Resolution", `${stream.width}×${stream.height}`],
              ["Bit depth", stream.bitDepth ? `${stream.bitDepth}-bit` : undefined],
              ["Frame rate", stream.frameRate ? `${stream.frameRate} fps` : undefined],
              ["Profile", stream.profile],
              ["Bitrate", formatBitrate(stream.bitrate)],
            ]),
          };
        }

        if (stream.streamType === 2) {
          return {
            id: stream.id,
            kind: "Audio",
            title: stream.extendedDisplayTitle || stream.displayTitle,
            rows: rowsFrom([
              ["Codec", formatStreamCodec(stream.codec)],
              ["Channels", stream.audioChannelLayout ?? stream.channels],
              ["Language", stream.language],
              ["Bitrate", formatBitrate(stream.bitrate)],
              ["Default", stream.default],
            ]),
          };
        }

        return {
          id: stream.id,
          kind: "Subtitle",
          title: stream.extendedDisplayTitle || stream.displayTitle,
          rows: rowsFrom([
            ["Codec", stream.codec ? formatStreamCodec(stream.codec) : undefined],
            ["Language", stream.language],
            ["Format", stream.format],
            ["SDH", stream.hearingImpaired],
            ["Default", stream.default],
          ]),
        };
      }),
    })),
  }));
}

export function getTechnicalRows(item: ItemMetadata) {
  const media = item.Media?.[0];
  const streams = media?.Part?.[0]?.Stream ?? [];
  const videoStream = streams.find((stream) => stream.streamType === 1);
  const audioStream =
    streams.find((stream) => stream.streamType === 2 && stream.selected) ??
    streams.find((stream) => stream.streamType === 2);
  const subtitleStream =
    streams.find((stream) => stream.streamType === 3 && stream.selected) ??
    streams.find((stream) => stream.streamType === 3);

  return [
    {
      label: "Video",
      value: media
        ? `${media.videoResolution} (${formatStreamCodec(videoStream?.codec ?? media.videoCodec)})`
        : undefined,
    },
    {
      label: "Audio",
      value: audioStream?.extendedDisplayTitle ?? audioStream?.displayTitle,
    },
    {
      label: "Subtitles",
      value: subtitleStream?.extendedDisplayTitle ?? subtitleStream?.displayTitle,
    },
  ].flatMap((row) => (row.value ? [{ label: row.label, value: row.value }] : []));
}
