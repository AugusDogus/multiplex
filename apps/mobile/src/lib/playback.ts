const DIRECT_AUDIO_CODECS = new Set(["aac", "mp3", "mpeg"]);
const DIRECT_VIDEO_CODECS = new Set(["h264", "hevc"]);
const DIRECT_CONTAINERS = new Set(["mp4", "m4v"]);

export interface PlaybackSource {
  uri: string;
  transcodeSessionKey: string | null;
  usesTranscode: boolean;
}

export interface MobilePlayableItem {
  key: string;
  Media?: Array<{
    audioCodec?: string;
    videoCodec?: string;
    container?: string;
    Part?: Array<{
      key?: string;
      Stream?: Array<{
        id: number;
        streamType: number;
        selected?: boolean;
      }>;
    }>;
  }>;
}

function baseServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/$/, "");
}

function applyClientParams(
  url: URL,
  input: {
    authToken: string;
    clientIdentifier: string;
    playbackSessionId: string;
  },
): void {
  url.searchParams.set("X-Plex-Token", input.authToken);
  url.searchParams.set("X-Plex-Platform", "Mobile");
  url.searchParams.set("X-Plex-Platform-Version", "1.0");
  url.searchParams.set("X-Plex-Product", "Multiplex");
  url.searchParams.set("X-Plex-Version", "1.0");
  url.searchParams.set("X-Plex-Client-Identifier", input.clientIdentifier);
  url.searchParams.set("X-Plex-Device", "Mobile");
  url.searchParams.set("X-Plex-Device-Name", "Multiplex Mobile");
  url.searchParams.set("X-Plex-Session-Identifier", input.playbackSessionId);
}

function canDirectPlay(item: MobilePlayableItem): boolean {
  const media = item.Media?.[0];
  const audio = media?.audioCodec?.toLowerCase();
  const video = media?.videoCodec?.toLowerCase();
  const container = media?.container?.toLowerCase();
  return Boolean(
    audio &&
    video &&
    container &&
    DIRECT_AUDIO_CODECS.has(audio) &&
    DIRECT_VIDEO_CODECS.has(video) &&
    DIRECT_CONTAINERS.has(container),
  );
}

function selectedSubtitleId(item: MobilePlayableItem): number | null {
  const selected = item.Media?.[0]?.Part?.[0]?.Stream?.find(
    (stream) => stream.streamType === 3 && stream.selected,
  );
  return selected?.id ?? null;
}

export function buildMobilePlaybackSource(input: {
  item: MobilePlayableItem;
  serverUrl: string;
  authToken: string;
  clientIdentifier: string;
  playbackSessionId: string;
  offsetSeconds: number;
  subtitleStreamId?: number | null;
  subtitleSizePercent?: number;
  audioStreamId?: number | null;
}): PlaybackSource | null {
  const partKey = input.item.Media?.[0]?.Part?.[0]?.key;
  if (!partKey) return null;

  const subtitleId =
    input.subtitleStreamId === undefined ? selectedSubtitleId(input.item) : input.subtitleStreamId;
  if (canDirectPlay(input.item) && subtitleId === null && input.audioStreamId === undefined) {
    const url = new URL(`${baseServerUrl(input.serverUrl)}${partKey}`);
    applyClientParams(url, input);
    url.searchParams.set("X-Plex-Protocol", "1.0");
    return { uri: url.toString(), transcodeSessionKey: null, usesTranscode: false };
  }

  const key = input.item.key;
  if (!key) return null;
  const subtitleKey = subtitleId ?? "n";
  const transcodeSessionKey = `${input.playbackSessionId}-${Math.floor(input.offsetSeconds)}-s${subtitleKey}`;
  const url = new URL(`${baseServerUrl(input.serverUrl)}/video/:/transcode/universal/start.mp4`);
  applyClientParams(url, input);
  url.searchParams.set("path", key);
  url.searchParams.set("mediaIndex", "0");
  url.searchParams.set("partIndex", "0");
  url.searchParams.set("protocol", "http");
  url.searchParams.set("fastSeek", "1");
  url.searchParams.set("directPlay", "0");
  url.searchParams.set("directStream", subtitleId === null ? "1" : "0");
  url.searchParams.set("directStreamAudio", "0");
  url.searchParams.set("audioBoost", "100");
  url.searchParams.set("subtitleSize", String(input.subtitleSizePercent ?? 100));
  url.searchParams.set("location", "lan");
  url.searchParams.set("session", transcodeSessionKey);
  url.searchParams.set("subtitles", subtitleId === null ? "none" : "burn");
  if (subtitleId !== null) {
    url.searchParams.set("hasMDE", "1");
    url.searchParams.set("subtitleStreamID", String(subtitleId));
  }
  if (input.audioStreamId !== undefined && input.audioStreamId !== null) {
    url.searchParams.set("audioStreamID", String(input.audioStreamId));
  }
  if (input.offsetSeconds > 0) {
    url.searchParams.set("offset", String(Math.floor(input.offsetSeconds)));
  }
  url.searchParams.set(
    "X-Plex-Client-Profile-Extra",
    [
      "add-direct-play(type=videoProfile&container=mp4&videoCodec=h264&audioCodec=aac)",
      "add-transcode-target(type=videoProfile&context=streaming&protocol=http&container=mp4&videoCodec=h264&audioCodec=aac)",
      "add-direct-stream-audio-codec(type=videoProfile&audioCodec=aac)",
    ].join("+"),
  );
  return { uri: url.toString(), transcodeSessionKey, usesTranscode: true };
}

export async function stopMobileTranscode(input: {
  serverUrl: string;
  authToken: string;
  clientIdentifier: string;
  playbackSessionId: string;
  transcodeSessionKey: string;
}): Promise<void> {
  const url = new URL(`${baseServerUrl(input.serverUrl)}/video/:/transcode/universal/stop`);
  applyClientParams(url, input);
  url.searchParams.set("session", input.transcodeSessionKey);
  await fetch(url.toString()).catch(() => undefined);
}
