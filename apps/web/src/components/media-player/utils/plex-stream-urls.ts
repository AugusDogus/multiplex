import { getPlexClientIdentifier } from "~/lib/device-identifier";
import type { MediaPlayerItem } from "~/types/media-player";
import type { PlexPlaybackPlan } from "./plex-playback-plan";

interface ClientProfile {
  platform: string;
  product: string;
  version: string;
  device: string;
  deviceName: string;
}

const CLIENT_PROFILE: ClientProfile = {
  platform: "Chrome",
  product: "Multiplex",
  version: "1.0",
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
  // Per-browser identifier: Plex keys transcode sessions by client identifier,
  // so a shared one would make two Watch Together viewers collide on a single
  // transcode session. See getPlexClientIdentifier().
  url.searchParams.set("X-Plex-Client-Identifier", getPlexClientIdentifier());
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

function buildDirectPlayUrl(
  item: MediaPlayerItem,
  serverUrl: string,
  authToken: string,
  sessionId: string,
): string {
  const partKey = item.Media?.[0]?.Part?.[0]?.key;
  if (!partKey) throw new Error("No media part key found for item");

  const baseUrl = getBaseServerUrl(serverUrl);
  const streamUrl = new URL(`${baseUrl}${partKey}`);
  applyClientHeaders(streamUrl, authToken);
  streamUrl.searchParams.set("X-Plex-Protocol", "1.0");
  // Unique per playback so simultaneous viewers (and repeat plays) don't share
  // a session.
  streamUrl.searchParams.set("X-Plex-Session-Identifier", sessionId);
  return streamUrl.toString();
}

/**
 * Build a Plex universal transcoder URL that direct-streams the video track
 * and transcodes only the audio to a browser-friendly codec.
 */
function buildDirectStreamUrl(
  item: MediaPlayerItem,
  serverUrl: string,
  authToken: string,
  offsetSeconds: number,
  selectedSubtitleStreamIndex: number | null,
  sessionId: string,
): string {
  const baseUrl = getBaseServerUrl(serverUrl);
  const streamUrl = new URL(`${baseUrl}/video/:/transcode/universal/start.mp4`);
  // Session = a fresh per-playback id (so two viewers / repeat plays never
  // collide) PLUS the offset. The offset matters because we reload the
  // transcode to seek (Plex's universal MP4 stream isn't seekable in-place); a
  // reload at a new offset must use a distinct session or it races the still-
  // running one on the same session and Plex rejects it (HTTP 400 -> the
  // "video source not supported" failure). Old offset sessions are short-lived
  // and the server times them out.
  const session = `${sessionId}-${Math.floor(offsetSeconds)}`;

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
  // browser silently rejects any video.currentTime change. To seek, ask the
  // transcoder to restart from `offset` seconds.
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
 */
export function generatePlexStreamUrl(
  item: MediaPlayerItem,
  serverUrl: string,
  authToken: string,
  playbackPlan: PlexPlaybackPlan,
  offsetSeconds = 0,
  sessionId: string,
): string {
  if (!item.Media?.[0]?.Part?.[0]?.key) {
    throw new Error("No media part key found for item");
  }

  return playbackPlan.streamDecision === "direct-play" &&
    playbackPlan.burnedSubtitleIndex === null
    ? buildDirectPlayUrl(item, serverUrl, authToken, sessionId)
    : buildDirectStreamUrl(
        item,
        serverUrl,
        authToken,
        offsetSeconds,
        playbackPlan.burnedSubtitleIndex,
        sessionId,
      );
}

export function hasValidStreamingData(item: MediaPlayerItem): boolean {
  return Boolean(
    item.Media?.[0]?.Part?.[0]?.key && item.serverUrl && item.authToken,
  );
}

/**
 * Tells Plex to stop the transcode session(s) started for a playback, freeing
 * the server's transcode slot immediately. Without this, sessions linger
 * (throttled but alive) until they time out, and concurrent viewers / repeat
 * plays then hit the server's transcode limit and get HTTP 400 ("video source
 * not supported"). Best-effort: stops every session whose id starts with this
 * playback's `sessionPrefix` (we use one base id per playback, suffixed by the
 * seek offset). The official Plex client stops its session the same way.
 */
export async function stopPlaybackTranscodeSessions(
  serverUrl: string,
  authToken: string,
  sessionPrefix: string,
): Promise<void> {
  if (!sessionPrefix) return;
  try {
    const baseUrl = getBaseServerUrl(serverUrl);
    const listUrl = new URL(`${baseUrl}/transcode/sessions`);
    applyClientHeaders(listUrl, authToken);
    const response = await fetch(listUrl.toString());
    if (!response.ok) return;

    const xml = await response.text();
    const keys = Array.from(xml.matchAll(/TranscodeSession key="([^"]+)"/g))
      .map((match) => match[1])
      .filter((key): key is string => Boolean(key?.startsWith(sessionPrefix)));

    await Promise.all(
      keys.map((key) => {
        const stopUrl = new URL(`${baseUrl}/video/:/transcode/universal/stop`);
        applyClientHeaders(stopUrl, authToken);
        stopUrl.searchParams.set("session", key);
        return fetch(stopUrl.toString()).catch(() => undefined);
      }),
    );
  } catch {
    // Best-effort cleanup; the server times sessions out regardless.
  }
}
