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

export type StreamDecision = "direct-play" | "direct-stream";

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

  const audioOk =
    !!audioCodec && BROWSER_DECODABLE_AUDIO_CODECS.has(audioCodec);
  const videoOk =
    !!videoCodec && BROWSER_DECODABLE_VIDEO_CODECS.has(videoCodec);

  return audioOk && videoOk ? "direct-play" : "direct-stream";
}

function buildDirectPlayUrl(
  item: MediaPlayerItem,
  serverUrl: string,
  authToken: string,
): string {
  const partKey = item.Media?.[0]?.Part?.[0]?.key;
  if (!partKey) throw new Error("No media part key found for item");

  const baseUrl = serverUrl.replace(/\/$/, "");
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
): string {
  if (!item.key) throw new Error("No metadata key found for item");

  const baseUrl = serverUrl.replace(/\/$/, "");
  const streamUrl = new URL(`${baseUrl}/video/:/transcode/universal/start.mp4`);

  applyClientHeaders(streamUrl, authToken);
  streamUrl.searchParams.set("path", item.key);
  streamUrl.searchParams.set("mediaIndex", "0");
  streamUrl.searchParams.set("partIndex", "0");
  streamUrl.searchParams.set("protocol", "http");
  streamUrl.searchParams.set("fastSeek", "1");
  streamUrl.searchParams.set("directPlay", "0");
  streamUrl.searchParams.set("directStream", "1");
  streamUrl.searchParams.set("directStreamAudio", "0");
  streamUrl.searchParams.set("audioBoost", "100");
  streamUrl.searchParams.set("subtitleSize", "100");
  streamUrl.searchParams.set("location", "lan");
  streamUrl.searchParams.set("session", `multiplex-${Date.now()}`);
  // Plex's transcoded MP4 stream advertises an empty seekable range, so the
  // browser silently rejects any video.currentTime change. To seek, we ask
  // the transcoder to restart from `offset` seconds; the new stream's t=0
  // corresponds to `offset` seconds in the original timeline.
  if (offsetSeconds > 0) {
    streamUrl.searchParams.set("offset", String(Math.floor(offsetSeconds)));
  }
  // Tell Plex our capabilities: we can take MP4+h264 with AAC audio direct,
  // and we want any other audio re-encoded to AAC.
  streamUrl.searchParams.set(
    "X-Plex-Client-Profile-Extra",
    [
      "add-direct-play(type=videoProfile&container=mp4&videoCodec=h264&audioCodec=aac)",
      "add-direct-play(type=videoProfile&container=mp4&videoCodec=h264&audioCodec=mp3)",
      "add-transcode-target(type=videoProfile&context=streaming&protocol=http&container=mp4&videoCodec=h264&audioCodec=aac)",
      "add-direct-stream-audio-codec(type=videoProfile&audioCodec=aac)",
      "add-direct-stream-audio-codec(type=videoProfile&audioCodec=mp3)",
    ].join("+"),
  );

  return streamUrl.toString();
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
): string {
  if (!item.Media?.[0]?.Part?.[0]?.key) {
    throw new Error("No media part key found for item");
  }

  const decision = decideStreamMode(item);
  return decision === "direct-play"
    ? buildDirectPlayUrl(item, serverUrl, authToken)
    : buildDirectStreamUrl(item, serverUrl, authToken, offsetSeconds);
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
