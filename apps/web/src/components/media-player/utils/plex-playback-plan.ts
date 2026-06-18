import type { MediaPlayerItem } from "~/types/media-player";

/**
 * Audio codecs Chromium-based browsers can decode in a video container.
 * EAC3, AC3, DTS, TrueHD, and FLAC variants commonly used in MKV releases
 * are NOT in this set because Chrome will silently drop the audio track.
 */
const BROWSER_DECODABLE_AUDIO_CODECS = new Set([
  "aac",
  "mp3",
  "mpeg",
  "opus",
  "vorbis",
]);

/**
 * Video codecs commonly playable via a plain `<video src>` in Chrome.
 * HEVC requires hardware support, so we let the transcoder fallback path handle
 * environments that cannot decode it.
 */
const BROWSER_DECODABLE_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);

/**
 * Containers Chrome can reliably play from a plain `<video src>`. MKV files can
 * contain browser-decodable codecs, but Plex's direct-play MKV endpoint has
 * proven unreliable, so route them through the remux path.
 */
const BROWSER_DIRECT_PLAY_CONTAINERS = new Set(["mp4", "m4v", "webm"]);

/**
 * Subtitle codecs Plex can expose as text tracks without forcing a video
 * transcode. Image subtitles still need burn-in.
 */
const SIDECAR_SUBTITLE_CODECS = new Set([
  "srt",
  "subrip",
  "webvtt",
  "vtt",
  "ass",
  "ssa",
  "text",
]);

export type StreamDecision = "direct-play" | "direct-stream";

export type SelectedSubtitleStream = {
  id: number;
  index: number | null;
  codec: string;
  key: string | null;
  format: string | null;
};

export type SubtitlePlan =
  | { kind: "none" }
  | { kind: "burnIn"; index: number }
  | { kind: "plexTrack"; index: number }
  | { kind: "externalText"; key: string }
  | { kind: "unsupported" };

export type PlexPlaybackPlan = {
  streamDecision: StreamDecision;
  videoUsesTranscode: boolean;
  burnedSubtitleIndex: number | null;
  subtitle: SubtitlePlan;
};

function isExternalSrtSubtitle(
  codec: string,
  format: string | null,
  key: string | null,
): key is string {
  if (!key) return false;
  return codec === "srt" || codec === "subrip" || format === "srt";
}

/**
 * Returns the Plex subtitle stream marked `selected` in item metadata, if any.
 */
export function getSelectedSubtitleStream(
  item: MediaPlayerItem,
): SelectedSubtitleStream | null {
  const streams = item.Media?.[0]?.Part?.[0]?.Stream ?? [];
  const selected = streams.find(
    (stream) => stream.streamType === 3 && stream.selected,
  );
  if (selected?.streamType !== 3) return null;
  return {
    id: selected.id,
    index: selected.index ?? null,
    codec: selected.codec.toLowerCase(),
    key: selected.key ?? null,
    format: selected.format?.toLowerCase() ?? null,
  };
}

function buildSubtitlePlan(
  streamDecision: StreamDecision,
  selected: SelectedSubtitleStream | null,
): SubtitlePlan {
  if (!selected) return { kind: "none" };

  const canDirectPlay = streamDecision === "direct-play";
  const isSidecarCodec = SIDECAR_SUBTITLE_CODECS.has(selected.codec);

  // Offset-based transcoded streams start at t=0 on the browser timeline, so
  // client-side text tracks cannot use the original subtitle timestamps.
  if (!canDirectPlay && selected.index !== null) {
    return { kind: "burnIn", index: selected.index };
  }

  if (isExternalSrtSubtitle(selected.codec, selected.format, selected.key)) {
    return { kind: "externalText", key: selected.key };
  }

  if (canDirectPlay && isSidecarCodec && selected.index !== null) {
    return { kind: "plexTrack", index: selected.index };
  }

  if (canDirectPlay && isSidecarCodec && selected.key) {
    return { kind: "externalText", key: selected.key };
  }

  if (selected.index !== null) {
    return { kind: "burnIn", index: selected.index };
  }

  return { kind: "unsupported" };
}

/** Single source of truth for video URL generation and subtitle delivery. */
export function buildPlexPlaybackPlan(item: MediaPlayerItem): PlexPlaybackPlan {
  const streamDecision = decideStreamMode(item);
  const subtitle = buildSubtitlePlan(
    streamDecision,
    getSelectedSubtitleStream(item),
  );
  const burnedSubtitleIndex =
    subtitle.kind === "burnIn" ? subtitle.index : null;

  return {
    streamDecision,
    videoUsesTranscode:
      streamDecision === "direct-stream" || subtitle.kind === "burnIn",
    burnedSubtitleIndex,
    subtitle,
  };
}

/** True when playback must route through Plex's universal remux/transcode URL. */
export function playbackUsesTranscode(item: MediaPlayerItem): boolean {
  return buildPlexPlaybackPlan(item).videoUsesTranscode;
}

/**
 * Decide whether the browser can direct-play the file or whether Plex needs to
 * remux/transcode it. When only the audio codec is unsupported, Plex keeps the
 * video track intact and transcodes audio to AAC.
 */
export function decideStreamMode(item: MediaPlayerItem): StreamDecision {
  const media = item.Media?.[0];
  const audioCodec = media?.audioCodec?.toLowerCase();
  const videoCodec = media?.videoCodec?.toLowerCase();
  const container = media?.container?.toLowerCase();

  const audioOk =
    !!audioCodec && BROWSER_DECODABLE_AUDIO_CODECS.has(audioCodec);
  const videoOk =
    !!videoCodec && BROWSER_DECODABLE_VIDEO_CODECS.has(videoCodec);
  const containerOk =
    !!container && BROWSER_DIRECT_PLAY_CONTAINERS.has(container);

  return audioOk && videoOk && containerOk ? "direct-play" : "direct-stream";
}
