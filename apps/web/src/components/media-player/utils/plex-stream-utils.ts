import type { MediaPlayerItem } from "~/types/media-player";

/* ────────────────────────────────────────────────────────────
   Plex Stream Utilities
   Functions for generating Plex streaming URLs and handling media data
   ──────────────────────────────────────────────────────────── */

/**
 * Audio codecs Chromium-based browsers can decode in a video container.
 * EAC3, AC3, DTS, TrueHD, and FLAC variants commonly used in MKV releases
 * are NOT in this set — Chrome will silently drop the audio track.
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
 * (HEVC requires hardware support; we still allow direct-play and let the
 * transcoder fallback path handle environments that can't decode it.)
 */
const BROWSER_DECODABLE_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);

/**
 * Containers Chrome can reliably play from a plain `<video src>`. MKV files
 * can contain browser-decodable codecs, but direct-playing Plex's MKV file
 * endpoint has proven unreliable, so route them through the remux path.
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

interface ClientProfile {
  platform: string;
  product: string;
  version: string;
  clientIdentifier: string;
  device: string;
  deviceName: string;
}

const CLIENT_PROFILE: ClientProfile = {
  platform: "Chrome",
  product: "Multiplex",
  version: "1.0",
  clientIdentifier: "multiplex-web",
  device: "Chrome",
  deviceName: "Multiplex Web",
};

function getBaseServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/$/, "");
}

function applyClientHeaders(url: URL, authToken: string): void {
  url.searchParams.set("X-Plex-Token", authToken);
  url.searchParams.set("X-Plex-Platform", CLIENT_PROFILE.platform);
  url.searchParams.set("X-Plex-Platform-Version", "1.0");
  url.searchParams.set("X-Plex-Product", CLIENT_PROFILE.product);
  url.searchParams.set("X-Plex-Version", CLIENT_PROFILE.version);
  url.searchParams.set(
    "X-Plex-Client-Identifier",
    CLIENT_PROFILE.clientIdentifier,
  );
  url.searchParams.set("X-Plex-Device", CLIENT_PROFILE.device);
  url.searchParams.set("X-Plex-Device-Name", CLIENT_PROFILE.deviceName);
}

function applyUniversalTranscodeParams(
  url: URL,
  item: MediaPlayerItem,
  protocol: "dash" | "http",
  session: string,
): void {
  if (!item.key) throw new Error("No metadata key found for item");

  url.searchParams.set("path", item.key);
  url.searchParams.set("mediaIndex", "0");
  url.searchParams.set("partIndex", "0");
  url.searchParams.set("protocol", protocol);
  url.searchParams.set("fastSeek", "1");
  url.searchParams.set("directPlay", "0");
  url.searchParams.set("directStream", "1");
  url.searchParams.set("directStreamAudio", "0");
  url.searchParams.set("audioBoost", "100");
  url.searchParams.set("subtitleSize", "100");
  url.searchParams.set("location", "lan");
  url.searchParams.set("session", session);
}

function applyUniversalTranscodeProfile(
  url: URL,
  protocol: "dash" | "http",
): void {
  // Tell Plex our capabilities: we can take MP4+h264 with AAC audio direct,
  // and we want any other audio re-encoded to AAC.
  url.searchParams.set(
    "X-Plex-Client-Profile-Extra",
    protocol === "dash"
      ? "append-transcode-target-codec(type=videoProfile&context=streaming&videoCodec=h264&audioCodec=aac&protocol=dash)"
      : [
          "add-direct-play(type=videoProfile&container=mp4&videoCodec=h264&audioCodec=aac)",
          "add-direct-play(type=videoProfile&container=mp4&videoCodec=h264&audioCodec=mp3)",
          "add-transcode-target(type=videoProfile&context=streaming&protocol=http&container=mp4&videoCodec=h264&audioCodec=aac)",
          "add-direct-stream-audio-codec(type=videoProfile&audioCodec=aac)",
          "add-direct-stream-audio-codec(type=videoProfile&audioCodec=mp3)",
        ].join("+"),
  );
}

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

/** Plex transcode URLs use `subtitleStreamID` with the stream's `index`. */
export function getSelectedSubtitleStreamIndex(
  item: MediaPlayerItem,
): number | null {
  return getSelectedSubtitleStream(item)?.index ?? null;
}

/** Whether the active transcode stream bakes `offset` into the URL. */
export function transcodeUsesOffsetTimeline(
  _item: MediaPlayerItem,
  streamOffset: number,
): boolean {
  return streamOffset > 0;
}

/** True when playback must route through Plex's universal remux/transcode URL. */
export function playbackUsesTranscode(item: MediaPlayerItem): boolean {
  return buildPlexPlaybackPlan(item).videoUsesTranscode;
}

/**
 * Decide whether the browser can direct-play the file or whether we need to
 * route through Plex's universal transcoder. When the audio codec isn't
 * browser-decodable but the video codec is, Plex direct-streams the video
 * (no re-encode) and transcodes only the audio to AAC.
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

function buildDirectPlayUrl(
  item: MediaPlayerItem,
  serverUrl: string,
  authToken: string,
): string {
  const partKey = item.Media?.[0]?.Part?.[0]?.key;
  if (!partKey) throw new Error("No media part key found for item");

  const baseUrl = getBaseServerUrl(serverUrl);
  const streamUrl = new URL(`${baseUrl}${partKey}`);
  applyClientHeaders(streamUrl, authToken);
  streamUrl.searchParams.set("X-Plex-Protocol", "1.0");
  streamUrl.searchParams.set(
    "X-Plex-Session-Identifier",
    `multiplex-${Date.now()}`,
  );
  return streamUrl.toString();
}

/**
 * Build a Plex universal transcoder URL that direct-streams the video track
 * (no re-encode) and transcodes only the audio to a browser-friendly codec.
 * Output container is fragmented MP4, which Chrome plays natively.
 */
function buildDirectStreamUrl(
  item: MediaPlayerItem,
  serverUrl: string,
  authToken: string,
  offsetSeconds: number,
  selectedSubtitleStreamIndex: number | null,
): string {
  const baseUrl = getBaseServerUrl(serverUrl);
  const streamUrl = new URL(`${baseUrl}/video/:/transcode/universal/start.mp4`);
  const session = `multiplex-${Date.now()}`;

  applyClientHeaders(streamUrl, authToken);
  applyUniversalTranscodeParams(streamUrl, item, "http", session);
  if (selectedSubtitleStreamIndex === null) {
    streamUrl.searchParams.set("subtitles", "none");
  } else {
    streamUrl.searchParams.set("directStream", "0");
    streamUrl.searchParams.set("subtitles", "burn");
    streamUrl.searchParams.set(
      "subtitleStreamID",
      String(selectedSubtitleStreamIndex),
    );
  }
  // Plex's transcoded MP4 stream advertises an empty seekable range, so the
  // browser silently rejects any video.currentTime change. To seek, we ask
  // the transcoder to restart from `offset` seconds; the new stream's t=0
  // corresponds to `offset` seconds in the original timeline.
  if (offsetSeconds > 0) {
    streamUrl.searchParams.set("offset", String(Math.floor(offsetSeconds)));
  }
  applyUniversalTranscodeProfile(streamUrl, "http");

  return streamUrl.toString();
}

export function buildPlexSubtitleSelectionUrl(
  item: MediaPlayerItem,
  serverUrl: string,
  authToken: string,
  selectedSubtitleStreamId: number | null,
): string {
  const partId = item.Media?.[0]?.Part?.[0]?.id;
  if (!partId) throw new Error("No media part id found for item");

  const baseUrl = getBaseServerUrl(serverUrl);
  const selectionUrl = new URL(`${baseUrl}/library/parts/${partId}`);

  applyClientHeaders(selectionUrl, authToken);
  selectionUrl.searchParams.set(
    "subtitleStreamID",
    String(selectedSubtitleStreamId ?? 0),
  );
  selectionUrl.searchParams.set("X-Plex-Text-Format", "plain");

  return selectionUrl.toString();
}

export function generatePlexSubtitleTrackUrl(
  item: MediaPlayerItem,
  serverUrl: string,
  authToken: string,
  selectedSubtitleStreamIndex: number,
): string {
  const baseUrl = getBaseServerUrl(serverUrl);
  const subtitleUrl = new URL(
    `${baseUrl}/video/:/transcode/universal/subtitles`,
  );
  const session = `multiplex-subtitles-${selectedSubtitleStreamIndex}-${Date.now()}`;

  applyClientHeaders(subtitleUrl, authToken);
  applyUniversalTranscodeParams(subtitleUrl, item, "dash", session);
  subtitleUrl.searchParams.set("transcodeSessionId", session);
  subtitleUrl.searchParams.set("hasMDE", "1");
  subtitleUrl.searchParams.set("location", "wan");
  subtitleUrl.searchParams.set("addDebugOverlay", "0");
  subtitleUrl.searchParams.set("autoAdjustQuality", "0");
  subtitleUrl.searchParams.set("mediaBufferSize", "102400");
  subtitleUrl.searchParams.set("subtitles", "sidecar");
  subtitleUrl.searchParams.set(
    "subtitleStreamID",
    String(selectedSubtitleStreamIndex),
  );
  subtitleUrl.searchParams.set("Accept-Language", "en");
  subtitleUrl.searchParams.set("X-Plex-Incomplete-Segments", "1");
  applyUniversalTranscodeProfile(subtitleUrl, "dash");

  return subtitleUrl.toString();
}

export function generatePlexExternalSubtitleUrl(
  serverUrl: string,
  authToken: string,
  subtitleStreamKey: string,
): string {
  const baseUrl = getBaseServerUrl(serverUrl);
  const subtitleUrl = new URL(`${baseUrl}${subtitleStreamKey}`);

  applyClientHeaders(subtitleUrl, authToken);

  return subtitleUrl.toString();
}

/**
 * Generate a Plex streaming URL for a media item.
 *
 * Chooses direct-play when the file's container/codecs are browser-friendly
 * (e.g. MP4/MKV with h264 + AAC). Falls back to Plex's universal transcoder
 * with `directStream=1` for files whose audio codec the browser can't decode
 * (e.g. EAC3/AC3/DTS/TrueHD/FLAC). In that mode the video track is remuxed
 * untouched and only the audio is transcoded — cheap on the Plex server and
 * preserves video quality.
 */
export function generatePlexStreamUrl(
  item: MediaPlayerItem,
  serverUrl: string,
  authToken: string,
  offsetSeconds = 0,
  selectedSubtitleStreamIndex: number | null = null,
): string {
  if (!item.Media?.[0]?.Part?.[0]?.key) {
    throw new Error("No media part key found for item");
  }

  const decision = decideStreamMode(item);
  return decision === "direct-play" && selectedSubtitleStreamIndex === null
    ? buildDirectPlayUrl(item, serverUrl, authToken)
    : buildDirectStreamUrl(
        item,
        serverUrl,
        authToken,
        offsetSeconds,
        selectedSubtitleStreamIndex,
      );
}

/**
 * Format time in seconds to human-readable format (MM:SS or HH:MM:SS)
 * @param seconds - Time in seconds
 * @returns Formatted time string
 */
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

/**
 * Calculate progress percentage from current time and duration
 * @param currentTime - Current playback time in seconds
 * @param duration - Total duration in seconds
 * @returns Progress percentage (0-100)
 */
export function calculateProgress(
  currentTime: number,
  duration: number,
): number {
  return duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
}

/**
 * Check if playback is near the end of the media
 * @param currentTime - Current playback time in seconds
 * @param duration - Total duration in seconds
 * @param threshold - Threshold in seconds to consider "near end" (default: 30)
 * @returns True if playback is within threshold seconds of the end
 */
export function isNearEnd(
  currentTime: number,
  duration: number,
  threshold = 30,
): boolean {
  return duration > 0 && duration - currentTime <= threshold;
}

/**
 * Convert milliseconds to seconds (Plex often uses milliseconds)
 * @param milliseconds - Time in milliseconds
 * @returns Time in seconds
 */
export function millisecondsToSeconds(milliseconds: number): number {
  return Math.floor(milliseconds / 1000);
}

/**
 * Convert seconds to milliseconds
 * @param seconds - Time in seconds
 * @returns Time in milliseconds
 */
export function secondsToMilliseconds(seconds: number): number {
  return Math.floor(seconds * 1000);
}

/**
 * Calculate the time remaining in a media item
 * @param currentTime - Current playback time in seconds
 * @param duration - Total duration in seconds
 * @returns Time remaining in seconds, or 0 if invalid
 */
export function calculateTimeRemaining(
  currentTime: number,
  duration: number,
): number {
  if (duration <= 0 || currentTime < 0) return 0;
  return Math.max(0, duration - currentTime);
}

/**
 * Check if a media item has valid streaming data
 * @param item - The media player item to validate
 * @returns True if the item has valid media parts for streaming
 */
export function hasValidStreamingData(item: MediaPlayerItem): boolean {
  return Boolean(
    item.Media?.[0]?.Part?.[0]?.key && item.serverUrl && item.authToken,
  );
}
