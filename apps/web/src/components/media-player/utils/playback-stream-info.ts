import type {
  ItemMetadata,
  StreamType as PlexStream,
} from "@multiplex/plex-query";
import type { MediaPlayerItem } from "~/types/media-player";
import {
  isPlayableSubtitleStream,
  resolveSelectedAudioStream,
} from "./plex-playback-plan";
type AudioStream = Extract<PlexStream, { streamType: 2 }>;
type SubtitleStream = Extract<PlexStream, { streamType: 3 }>;

/**
 * Either the shallow item from the continue-watching hub or the fully
 * expanded metadata fetched on demand. Both expose the same `Media[]`
 * shape, but only the latter reliably contains `Part[].Stream[]`.
 */
type StreamSource = MediaPlayerItem | ItemMetadata | null | undefined;

export function getQualityLabel(item: StreamSource): string {
  const media = item?.Media?.[0];
  if (!media) return "Original";

  const details = [
    formatBitrate(media.bitrate),
    formatResolution(media.height, media.videoResolution),
  ].filter((value): value is string => Boolean(value));

  if (details.length === 0) return "Original";
  return `Original (${details.join(", ")})`;
}

function formatBitrate(bitrate?: number): string | null {
  if (!bitrate) return null;

  if (bitrate >= 1000) {
    return `${(bitrate / 1000).toFixed(1)} Mbps`;
  }

  return `${bitrate} Kbps`;
}

function formatResolution(
  height?: number,
  videoResolution?: string,
): string | null {
  const resolution = height ?? Number(videoResolution);
  if (!Number.isFinite(resolution) || resolution <= 0) return null;

  if (resolution >= 720) {
    return `${resolution}p HD`;
  }

  return `${resolution}p`;
}

export function getAudioStreams(item: StreamSource): AudioStream[] {
  const streams = item?.Media?.[0]?.Part?.[0]?.Stream ?? [];
  return streams.filter(
    (stream): stream is AudioStream => stream.streamType === 2,
  );
}

export function getAudioStreamLabel(item: StreamSource): string {
  const audioStream = resolveSelectedAudioStream(getAudioStreams(item));

  if (!audioStream) {
    const media = item?.Media?.[0];
    if (!media?.audioCodec) return "Unavailable";
    return media.audioCodec.toUpperCase();
  }

  return getStreamLabel(audioStream, "Audio");
}

export function getSubtitleStreams(item: StreamSource): SubtitleStream[] {
  const streams = item?.Media?.[0]?.Part?.[0]?.Stream ?? [];
  return streams.filter(
    (stream): stream is SubtitleStream =>
      stream.streamType === 3 && isPlayableSubtitleStream(stream),
  );
}

export function getStreamLabel(stream: PlexStream, fallback: string): string {
  const displayTitle = stream.displayTitle ?? stream.language ?? fallback;
  const extendedTitle = stream.extendedDisplayTitle;

  if (!extendedTitle || extendedTitle === displayTitle) {
    return displayTitle;
  }

  if (extendedTitle.startsWith(displayTitle)) {
    const detail = extendedTitle
      .slice(displayTitle.length)
      .replace(/[()]/g, "")
      .trim();

    return detail ? `${displayTitle}, ${detail}` : displayTitle;
  }

  return extendedTitle;
}
