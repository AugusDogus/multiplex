import { describe, expect, test } from "bun:test";

import { buildMobilePlaybackSource, type MobilePlayableItem } from "./playback";

const baseInput = {
  serverUrl: "https://plex.example:32400",
  authToken: "plex-token",
  clientIdentifier: "mobile-device",
  playbackSessionId: "playback-session",
};

describe("buildMobilePlaybackSource", () => {
  test("direct plays a compatible MP4", () => {
    const item = {
      key: "/library/metadata/42",
      Media: [
        {
          audioCodec: "aac",
          videoCodec: "h264",
          container: "mp4",
          Part: [{ key: "/library/parts/42/file.mp4" }],
        },
      ],
    } satisfies MobilePlayableItem;

    const source = buildMobilePlaybackSource({
      ...baseInput,
      item,
      offsetSeconds: 0,
    });

    expect(source?.usesTranscode).toBe(false);
    expect(source?.transcodeSessionKey).toBeNull();
    const url = source ? new URL(source.uri) : null;
    expect(url?.pathname).toBe("/library/parts/42/file.mp4");
    expect(url?.searchParams.get("X-Plex-Token")).toBe("plex-token");
    expect(url?.searchParams.get("X-Plex-Client-Identifier")).toBe("mobile-device");
  });

  test("transcodes unsupported audio and burns the selected subtitle", () => {
    const item = {
      key: "/library/metadata/84",
      Media: [
        {
          audioCodec: "eac3",
          videoCodec: "h264",
          container: "mkv",
          Part: [
            {
              key: "/library/parts/84/file.mkv",
              Stream: [{ id: 9, streamType: 3, selected: true }],
            },
          ],
        },
      ],
    } satisfies MobilePlayableItem;

    const source = buildMobilePlaybackSource({
      ...baseInput,
      item,
      offsetSeconds: 125.8,
    });

    expect(source?.usesTranscode).toBe(true);
    expect(source?.transcodeSessionKey).toBe("playback-session-125-s9");
    const url = source ? new URL(source.uri) : null;
    expect(url?.pathname).toBe("/video/:/transcode/universal/start.mp4");
    expect(url?.searchParams.get("offset")).toBe("125");
    expect(url?.searchParams.get("subtitles")).toBe("burn");
    expect(url?.searchParams.get("subtitleStreamID")).toBe("9");
  });
});
