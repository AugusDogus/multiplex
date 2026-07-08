import type { MediaPlayerItem } from "~/types/media-player";

/* ────────────────────────────────────────────────────────────
   Client Remux Support
   Decides when in-browser remuxing (Mediabunny + MediaSource) can replace a
   Plex server transcode, and tracks the user preference plus per-item
   failures so a broken pipeline never retries in a loop.
   ──────────────────────────────────────────────────────────── */

/**
 * Video codecs the engine will copy into fragmented MP4 without re-encoding.
 * Kept to H.264 for now: it is the only codec that is both ubiquitous in
 * Plex libraries and safely decodable across every MSE-capable browser
 * (HEVC/AV1 support is hardware-dependent and HDR handling differs).
 */
const CLIENT_REMUX_VIDEO_CODECS = new Set(["h264", "avc"]);

/**
 * Audio codecs the engine can handle: either copied directly into MP4 when
 * the browser can decode them (aac/mp3/opus/flac) or decoded by Mediabunny
 * (AC-3/E-AC-3 via @mediabunny/ac3) and re-encoded to AAC.
 */
const CLIENT_REMUX_AUDIO_CODECS = new Set([
  "aac",
  "mp3",
  "opus",
  "flac",
  "ac3",
  "eac3",
]);

/**
 * Containers Mediabunny can demux. Notably excludes AVI/WMV/FLV, which Plex
 * libraries occasionally contain but Mediabunny cannot read.
 */
const CLIENT_REMUX_CONTAINERS = new Set(["mp4", "m4v", "mov", "mkv", "webm"]);

export const CLIENT_REMUX_PREFERENCE_STORAGE_KEY =
  "multiplex:client-remux-enabled";

/**
 * Static codec/container gate based on Plex metadata alone. The engine
 * re-validates against the actual file (via Mediabunny probing and
 * `MediaSource.isTypeSupported`) before playing and falls back on mismatch.
 */
export function isClientRemuxCodecSupported(item: MediaPlayerItem): boolean {
  const media = item.Media?.[0];
  const videoCodec = media?.videoCodec?.toLowerCase();
  const audioCodec = media?.audioCodec?.toLowerCase();
  const container = media?.container?.toLowerCase();

  return (
    !!videoCodec &&
    CLIENT_REMUX_VIDEO_CODECS.has(videoCodec) &&
    !!audioCodec &&
    CLIENT_REMUX_AUDIO_CODECS.has(audioCodec) &&
    !!container &&
    CLIENT_REMUX_CONTAINERS.has(container)
  );
}

function isMediaSourceSupported(): boolean {
  return typeof window !== "undefined" && "MediaSource" in window;
}

/* ── User preference (default on) ─────────────────────────── */

const preferenceListeners = new Set<() => void>();

export function isClientRemuxPreferred(): boolean {
  if (typeof window === "undefined") return true;
  return (
    window.localStorage.getItem(CLIENT_REMUX_PREFERENCE_STORAGE_KEY) !== "0"
  );
}

export function setClientRemuxPreferred(enabled: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    CLIENT_REMUX_PREFERENCE_STORAGE_KEY,
    enabled ? "1" : "0",
  );
  for (const listener of preferenceListeners) listener();
}

/** Subscribe to preference changes (for `useSyncExternalStore`). */
export function subscribeClientRemuxPreference(listener: () => void) {
  preferenceListeners.add(listener);
  return () => {
    preferenceListeners.delete(listener);
  };
}

/* ── Per-item failure tracking ────────────────────────────── */

// Session-scoped: a failed pipeline (bad file, decoder crash, quota storm)
// must not retry on every render or replay, but a page reload gets a fresh
// chance in case the failure was transient.
const failedItems = new Set<string>();

function itemKey(item: Pick<MediaPlayerItem, "serverId" | "ratingKey">) {
  return `${item.serverId}:${item.ratingKey}`;
}

export function markClientRemuxFailed(
  item: Pick<MediaPlayerItem, "serverId" | "ratingKey">,
): void {
  failedItems.add(itemKey(item));
}

export function hasClientRemuxFailed(
  item: Pick<MediaPlayerItem, "serverId" | "ratingKey">,
): boolean {
  return failedItems.has(itemKey(item));
}

/**
 * Environment gate: browser capability, user preference, and the per-item
 * failure blacklist. Does not include the codec check.
 */
export function isClientRemuxRuntimeAvailable(item: MediaPlayerItem): boolean {
  return (
    isMediaSourceSupported() &&
    isClientRemuxPreferred() &&
    !hasClientRemuxFailed(item)
  );
}
