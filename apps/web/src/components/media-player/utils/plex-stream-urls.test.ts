import { expect, mock, test } from "bun:test";

import type { MediaPlayerItem } from "~/types/media-player";
import type { PlexPlaybackPlan } from "./plex-playback-plan";
import {
  buildPlexTranscodeSessionKey,
  generatePlexStreamUrl,
  stopTranscodeSession,
} from "./plex-stream-urls";

const TRANSCODE_ITEM = {
  ratingKey: "42",
  key: "/library/metadata/42",
  serverId: "server-1",
  serverUrl: "https://plex.example",
  authToken: "secret-token",
  Media: [
    {
      audioCodec: "eac3",
      videoCodec: "h264",
      container: "mkv",
      Part: [{ key: "/library/parts/42/file.mkv" }],
    },
  ],
} as MediaPlayerItem;

const TRANSCODE_WITHOUT_SUBTITLES: PlexPlaybackPlan = {
  streamDecision: "direct-stream",
  videoUsesTranscode: true,
  burnedSubtitleIndex: null,
  subtitle: { kind: "none" },
};

const PLAYBACK_SESSION_ID = "0123456789abcdef01234567";

const transcodeWithBurnedSubtitle = (index: number): PlexPlaybackPlan => ({
  streamDecision: "direct-stream",
  videoUsesTranscode: true,
  burnedSubtitleIndex: index,
  subtitle: { kind: "burnIn", index },
});

test("keeps a valid playback identifier while isolating subtitle transcodes", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => "test-client-id",
        setItem: () => undefined,
      },
    },
  });

  try {
    const withoutSubtitles = new URL(
      generatePlexStreamUrl(
        TRANSCODE_ITEM,
        TRANSCODE_ITEM.serverUrl,
        TRANSCODE_ITEM.authToken,
        TRANSCODE_WITHOUT_SUBTITLES,
        3158,
        PLAYBACK_SESSION_ID,
      ),
    );
    const withSubtitleTwo = new URL(
      generatePlexStreamUrl(
        TRANSCODE_ITEM,
        TRANSCODE_ITEM.serverUrl,
        TRANSCODE_ITEM.authToken,
        transcodeWithBurnedSubtitle(2),
        3158,
        PLAYBACK_SESSION_ID,
      ),
    );
    const withSubtitleThree = new URL(
      generatePlexStreamUrl(
        TRANSCODE_ITEM,
        TRANSCODE_ITEM.serverUrl,
        TRANSCODE_ITEM.authToken,
        transcodeWithBurnedSubtitle(3),
        3158,
        PLAYBACK_SESSION_ID,
      ),
    );

    expect(withoutSubtitles.searchParams.get("session")).toBe(
      buildPlexTranscodeSessionKey(PLAYBACK_SESSION_ID, 3158, null),
    );
    expect(withoutSubtitles.searchParams.get("X-Plex-Session-Identifier")).toBe(
      PLAYBACK_SESSION_ID,
    );
    expect(withoutSubtitles.searchParams.get("subtitles")).toBe("none");
    expect(withoutSubtitles.searchParams.get("subtitleStreamID")).toBeNull();
    expect(withoutSubtitles.searchParams.get("directStream")).toBe("1");
    expect(withoutSubtitles.searchParams.get("offset")).toBe("3158");
    expect(withSubtitleTwo.searchParams.get("session")).toBe(
      buildPlexTranscodeSessionKey(PLAYBACK_SESSION_ID, 3158, 2),
    );
    expect(withSubtitleTwo.searchParams.get("X-Plex-Session-Identifier")).toBe(
      PLAYBACK_SESSION_ID,
    );
    expect(withSubtitleTwo.searchParams.get("subtitles")).toBe("burn");
    expect(withSubtitleTwo.searchParams.get("subtitleStreamID")).toBe("2");
    expect(withSubtitleTwo.searchParams.get("directStream")).toBe("0");
    expect(withSubtitleTwo.searchParams.get("offset")).toBe("3158");
    expect(withSubtitleThree.searchParams.get("session")).toBe(
      buildPlexTranscodeSessionKey(PLAYBACK_SESSION_ID, 3158, 3),
    );
    expect(
      withSubtitleThree.searchParams.get("X-Plex-Session-Identifier"),
    ).toBe(PLAYBACK_SESSION_ID);
    expect(
      new Set([
        withoutSubtitles.searchParams.get("session"),
        withSubtitleTwo.searchParams.get("session"),
        withSubtitleThree.searchParams.get("session"),
      ]).size,
    ).toBe(3);
    expect(
      [withoutSubtitles, withSubtitleTwo, withSubtitleThree].every((url) => {
        const transcodeSession = url.searchParams.get("session");
        return (
          transcodeSession !== null &&
          transcodeSession.length <= 64 &&
          /^[a-zA-Z0-9-]+$/.test(transcodeSession)
        );
      }),
    ).toBe(true);
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});

test("stops the current transcode with a page-close-safe request", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const fetch = mock(
    async (
      _input: Parameters<typeof globalThis.fetch>[0],
      _init?: Parameters<typeof globalThis.fetch>[1],
    ) => new Response(),
  );
  globalThis.fetch = Object.assign(fetch, {
    preconnect: originalFetch.preconnect,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => "test-client-id",
        setItem: () => undefined,
      },
    },
  });

  try {
    await stopTranscodeSession(
      "https://plex.example",
      "secret-token",
      "multiplex-session-42",
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const call = fetch.mock.calls[0];
    expect(call).toBeDefined();
    const [input, init] = call!;
    expect(init).toEqual({ keepalive: true });
    const requestUrl =
      input instanceof URL
        ? input.href
        : input instanceof Request
          ? input.url
          : input;
    const url = new URL(requestUrl);
    expect(url.pathname).toBe("/video/:/transcode/universal/stop");
    expect(url.searchParams.get("session")).toBe("multiplex-session-42");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
