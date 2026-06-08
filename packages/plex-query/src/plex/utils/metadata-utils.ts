import type {
  EnrichedItemMetadataChild,
  ItemMetadata,
  ItemMetadataChild,
  LibrarySectionFields,
  PlayableEnrichedChild,
  PlayableMetadata,
} from "../schemas/continue-watching-schemas";

/* ────────────────────────────────────────────────────────────
   Metadata utilities for item details and hierarchy navigation
   ──────────────────────────────────────────────────────────── */

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

export function resolvePlayTarget(
  item: ItemMetadata,
  playableChildren: PlayableEnrichedChild[],
): PlayableMetadata | null {
  const itemPlayable = toPlayableMetadata(item);
  if (itemPlayable) {
    return itemPlayable;
  }

  if (item.type === "season") {
    return playableChildren[0] ?? null;
  }

  return null;
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

export function formatEpisodeListLabel(item: Pick<ItemMetadata, "index" | "duration">) {
  return [item.index ? `Episode ${item.index}` : undefined, formatMetadataDuration(item.duration)]
    .flatMap((value) => (value ? [value] : []))
    .join(" • ");
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

export type MetadataPosterInput = Pick<
  ItemMetadata,
  "type" | "thumb" | "grandparentThumb" | "parentThumb"
>;

export function getPosterImagePath(item: MetadataPosterInput): string | undefined {
  if (item.type === "episode") {
    return item.grandparentThumb ?? item.thumb;
  }

  if (item.type === "season") {
    return item.parentThumb ?? item.thumb;
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
