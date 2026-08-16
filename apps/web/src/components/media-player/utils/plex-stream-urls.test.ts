import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { fromPartial } from "@total-typescript/shoehorn";

import type { MediaPlayerItem } from "~/types/media-player";
import type { PlexPlaybackPlan } from "./plex-playback-plan";
import {
  buildPlexAudioSelectionUrl,
  buildPlexTranscodeSessionKey,
  consumeStoppedTranscodeSession,
  generatePlexStreamUrl,
  markTranscodeSessionStopped,
  pingTranscodeSession,
  preparePlexTranscodeDecision,
  stopPlaybackTranscodeSessions,
  stopTranscodeSession,
  stopTranscodeSessionBeforeReplacement,
} from "./plex-stream-urls";

const TRANSCODE_ITEM = fromPartial<MediaPlayerItem>({
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
});

const TRANSCODE_WITHOUT_SUBTITLES: PlexPlaybackPlan = {
  streamDecision: "direct-stream",
  videoUsesTranscode: true,
  burnedSubtitleId: null,
  selectedAudioStreamId: null,
  subtitle: { kind: "none" },
};

const PLAYBACK_SESSION_ID = "0123456789abcdef01234567";
const TRANSCODE_SESSION_ID = "fedcba9876543210fedcba98";
const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => "test-client-id",
        setItem: () => undefined,
      },
    },
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

function getRequestUrl(input: Parameters<typeof globalThis.fetch>[0]): string {
  return input instanceof URL
    ? input.href
    : input instanceof Request
      ? input.url
      : input;
}

function installFetchMock(
  implementation: (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ) => Promise<Response>,
) {
  const fetchMock = mock(implementation);
  globalThis.fetch = Object.assign(fetchMock, {
    preconnect: originalFetch.preconnect,
  });
  return fetchMock;
}

const transcodeWithBurnedSubtitle = (
  id: number,
  index: number,
): PlexPlaybackPlan => ({
  streamDecision: "direct-stream",
  videoUsesTranscode: true,
  burnedSubtitleId: id,
  selectedAudioStreamId: null,
  subtitle: { kind: "burnIn", id, index },
});

test("keeps a valid playback identifier while isolating subtitle transcodes", () => {
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
      transcodeWithBurnedSubtitle(1_572_872, 2),
      3158,
      PLAYBACK_SESSION_ID,
    ),
  );
  const withSubtitleThree = new URL(
    generatePlexStreamUrl(
      TRANSCODE_ITEM,
      TRANSCODE_ITEM.serverUrl,
      TRANSCODE_ITEM.authToken,
      transcodeWithBurnedSubtitle(1_572_873, 3),
      3158,
      PLAYBACK_SESSION_ID,
    ),
  );

  expect(withoutSubtitles.searchParams.get("session")).toBe(
    buildPlexTranscodeSessionKey(
      PLAYBACK_SESSION_ID,
      3158,
      TRANSCODE_WITHOUT_SUBTITLES,
    ),
  );
  expect(withoutSubtitles.searchParams.get("X-Plex-Session-Identifier")).toBe(
    PLAYBACK_SESSION_ID,
  );
  expect(withoutSubtitles.searchParams.get("hasMDE")).toBeNull();
  expect(withoutSubtitles.searchParams.get("subtitles")).toBe("none");
  expect(withoutSubtitles.searchParams.get("subtitleStreamID")).toBeNull();
  expect(withoutSubtitles.searchParams.get("audioStreamID")).toBeNull();
  expect(withoutSubtitles.searchParams.get("directStream")).toBe("1");
  expect(withoutSubtitles.searchParams.get("offset")).toBe("3158");
  expect(withSubtitleTwo.searchParams.get("session")).toBe(
    buildPlexTranscodeSessionKey(
      PLAYBACK_SESSION_ID,
      3158,
      transcodeWithBurnedSubtitle(1_572_872, 2),
    ),
  );
  expect(withSubtitleTwo.searchParams.get("X-Plex-Session-Identifier")).toBe(
    PLAYBACK_SESSION_ID,
  );
  expect(withSubtitleTwo.searchParams.get("subtitles")).toBe("burn");
  expect(withSubtitleTwo.searchParams.get("hasMDE")).toBe("1");
  expect(withSubtitleTwo.searchParams.get("subtitleStreamID")).toBe("1572872");
  expect(withSubtitleTwo.searchParams.get("directStream")).toBe("0");
  expect(withSubtitleTwo.searchParams.get("offset")).toBe("3158");
  expect(withSubtitleThree.searchParams.get("session")).toBe(
    buildPlexTranscodeSessionKey(
      PLAYBACK_SESSION_ID,
      3158,
      transcodeWithBurnedSubtitle(1_572_873, 3),
    ),
  );
  expect(withSubtitleThree.searchParams.get("X-Plex-Session-Identifier")).toBe(
    PLAYBACK_SESSION_ID,
  );
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
});

test("uses a fresh transcode key when retrying the same source", () => {
  const retried = new URL(
    generatePlexStreamUrl(
      TRANSCODE_ITEM,
      TRANSCODE_ITEM.serverUrl,
      TRANSCODE_ITEM.authToken,
      TRANSCODE_WITHOUT_SUBTITLES,
      0,
      PLAYBACK_SESSION_ID,
      1,
    ),
  );

  expect(retried.searchParams.get("session")).toBe(
    buildPlexTranscodeSessionKey(
      PLAYBACK_SESSION_ID,
      0,
      TRANSCODE_WITHOUT_SUBTITLES,
      1,
    ),
  );
  expect(retried.searchParams.get("session")).not.toBe(
    buildPlexTranscodeSessionKey(
      PLAYBACK_SESSION_ID,
      0,
      TRANSCODE_WITHOUT_SUBTITLES,
    ),
  );
  expect(retried.searchParams.get("X-Plex-Session-Identifier")).toBe(
    PLAYBACK_SESSION_ID,
  );
});

test("separates persistent playback identity from reload cleanup ownership", () => {
  const reloaded = new URL(
    generatePlexStreamUrl(
      TRANSCODE_ITEM,
      TRANSCODE_ITEM.serverUrl,
      TRANSCODE_ITEM.authToken,
      TRANSCODE_WITHOUT_SUBTITLES,
      15,
      PLAYBACK_SESSION_ID,
      0,
      TRANSCODE_SESSION_ID,
    ),
  );

  expect(reloaded.searchParams.get("X-Plex-Session-Identifier")).toBe(
    PLAYBACK_SESSION_ID,
  );
  expect(reloaded.searchParams.get("session")).toBe(
    buildPlexTranscodeSessionKey(
      TRANSCODE_SESSION_ID,
      15,
      TRANSCODE_WITHOUT_SUBTITLES,
    ),
  );
});

test("pings the current transcode session so PMS keeps it alive", async () => {
  const fetch = installFetchMock(async () => new Response());

  const pinged = await pingTranscodeSession(
    "https://plex.example",
    "secret-token",
    "multiplex-session-42",
  );

  expect(pinged).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  const url = new URL(getRequestUrl(fetch.mock.calls[0]![0]));
  expect(url.pathname).toBe("/video/:/transcode/universal/ping");
  expect(url.searchParams.get("session")).toBe("multiplex-session-42");
});

test("stops the current transcode with a page-close-safe request", async () => {
  const fetch = installFetchMock(async () => new Response());

  const stopped = await stopTranscodeSession(
    "https://plex.example",
    "secret-token",
    "multiplex-session-42",
  );

  expect(stopped).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [input, init] = fetch.mock.calls[0]!;
  expect(init).toEqual({ keepalive: true });
  const url = new URL(getRequestUrl(input));
  expect(url.pathname).toBe("/video/:/transcode/universal/stop");
  expect(url.searchParams.get("session")).toBe("multiplex-session-42");
});

test("sweeps again for a transcode that starts after initial cleanup", async () => {
  const events: string[] = [];
  let listRequests = 0;
  installFetchMock(async (input) => {
    const url = new URL(getRequestUrl(input));
    if (url.pathname === "/transcode/sessions") {
      listRequests += 1;
      events.push(`list-${listRequests}`);
      const body =
        listRequests === 1
          ? '<MediaContainer size="0" />'
          : `<MediaContainer size="1"><TranscodeSession key="${PLAYBACK_SESSION_ID}-late" /></MediaContainer>`;
      return new Response(body);
    }
    events.push(`stop-${url.searchParams.get("session") ?? "missing"}`);
    return new Response();
  });

  await stopPlaybackTranscodeSessions(
    "https://plex.example",
    "secret-token",
    PLAYBACK_SESSION_ID,
    {
      retryDelaysMs: [0, 1],
      wait: async (milliseconds) => {
        events.push(`wait-${milliseconds}`);
      },
    },
  );

  expect(events).toEqual([
    "list-1",
    "wait-1",
    "list-2",
    `stop-${PLAYBACK_SESSION_ID}-late`,
  ]);
});

test("repeated replacement sweeps preserve the newest transcode session", async () => {
  const stopped: string[] = [];
  let activeSession = `${PLAYBACK_SESSION_ID}-first`;
  installFetchMock(async (input) => {
    const url = new URL(getRequestUrl(input));
    if (url.pathname === "/transcode/sessions") {
      const newest = `${PLAYBACK_SESSION_ID}-newest`;
      const newestTag =
        activeSession === newest ? `<TranscodeSession key="${newest}" />` : "";
      return new Response(
        `<MediaContainer><TranscodeSession key="${PLAYBACK_SESSION_ID}-old" /><TranscodeSession key="${PLAYBACK_SESSION_ID}-first" />${newestTag}</MediaContainer>`,
      );
    }
    stopped.push(url.searchParams.get("session") ?? "missing");
    return new Response();
  });

  const cleanup = stopPlaybackTranscodeSessions(
    "https://plex.example",
    "secret-token",
    PLAYBACK_SESSION_ID,
    {
      retryDelaysMs: [0, 1],
      wait: async () => {
        activeSession = `${PLAYBACK_SESSION_ID}-newest`;
      },
      keepSessionKey: () => activeSession,
    },
  );
  await cleanup;

  expect(stopped).toEqual([
    `${PLAYBACK_SESSION_ID}-old`,
    `${PLAYBACK_SESSION_ID}-old`,
    `${PLAYBACK_SESSION_ID}-first`,
  ]);
  expect(stopped).not.toContain(`${PLAYBACK_SESSION_ID}-newest`);
});

test("reports a failed stop without suppressing modal cleanup", async () => {
  installFetchMock(async () => {
    throw new TypeError("network unavailable");
  });
  const sessionKey = "multiplex-session-stop-failed";

  const stopped = await stopTranscodeSessionBeforeReplacement(
    "https://plex.example",
    "secret-token",
    sessionKey,
  );

  expect(stopped).toBe(false);
  expect(consumeStoppedTranscodeSession(sessionKey)).toBe(false);
});

test("treats an already-gone transcode as successfully stopped", async () => {
  installFetchMock(
    async () => new Response(null, { status: 404, statusText: "Not Found" }),
  );

  const stopped = await stopTranscodeSession(
    "https://plex.example",
    "secret-token",
    "multiplex-session-already-gone",
  );

  expect(stopped).toBe(true);
});

test("suppresses modal cleanup only after replacement is applied", () => {
  const sessionKey = "multiplex-session-replaced";

  expect(consumeStoppedTranscodeSession(sessionKey)).toBe(false);
  markTranscodeSessionStopped(sessionKey);
  expect(consumeStoppedTranscodeSession(sessionKey)).toBe(true);
  expect(consumeStoppedTranscodeSession(sessionKey)).toBe(false);
});

test("completes old transcode cleanup before allowing replacement", async () => {
  const events: string[] = [];
  let releaseStop!: () => void;
  const stopResponse = new Promise<void>((resolve) => {
    releaseStop = resolve;
  });
  installFetchMock(async () => {
    events.push("stop-requested");
    await stopResponse;
    events.push("stop-completed");
    return new Response();
  });

  const sessionKey = "multiplex-session-before-replacement";
  const cleanup = stopTranscodeSessionBeforeReplacement(
    "https://plex.example",
    "secret-token",
    sessionKey,
  ).then((stopped) => {
    events.push("replacement-ready");
    return stopped;
  });

  await Promise.resolve();
  expect(events).toEqual(["stop-requested"]);

  releaseStop();
  const stopped = await cleanup;

  expect(stopped).toBe(true);
  expect(events).toEqual([
    "stop-requested",
    "stop-completed",
    "replacement-ready",
  ]);
  expect(consumeStoppedTranscodeSession(sessionKey)).toBe(false);
});

test("pairs each media decision with its replacement start session", async () => {
  const fetch = installFetchMock(async () => new Response());
  const subtitlePlan = transcodeWithBurnedSubtitle(1_572_872, 2);

  const subtitleReady = await preparePlexTranscodeDecision(
    TRANSCODE_ITEM,
    TRANSCODE_ITEM.serverUrl,
    TRANSCODE_ITEM.authToken,
    subtitlePlan,
    474,
    PLAYBACK_SESSION_ID,
  );
  const uncaptionedReady = await preparePlexTranscodeDecision(
    TRANSCODE_ITEM,
    TRANSCODE_ITEM.serverUrl,
    TRANSCODE_ITEM.authToken,
    TRANSCODE_WITHOUT_SUBTITLES,
    501,
    PLAYBACK_SESSION_ID,
  );

  expect(subtitleReady).toBe(true);
  expect(uncaptionedReady).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);

  const subtitleDecision = new URL(getRequestUrl(fetch.mock.calls[0]![0]));
  const subtitleStart = new URL(
    generatePlexStreamUrl(
      TRANSCODE_ITEM,
      TRANSCODE_ITEM.serverUrl,
      TRANSCODE_ITEM.authToken,
      subtitlePlan,
      474,
      PLAYBACK_SESSION_ID,
    ),
  );
  expect(subtitleDecision.pathname).toBe(
    "/video/:/transcode/universal/decision",
  );
  expect(subtitleDecision.search).toBe(subtitleStart.search);
  expect(fetch.mock.calls[0]![1]).toEqual({
    headers: { Accept: "application/xml" },
  });

  const uncaptionedDecision = new URL(getRequestUrl(fetch.mock.calls[1]![0]));
  const uncaptionedStart = new URL(
    generatePlexStreamUrl(
      TRANSCODE_ITEM,
      TRANSCODE_ITEM.serverUrl,
      TRANSCODE_ITEM.authToken,
      TRANSCODE_WITHOUT_SUBTITLES,
      501,
      PLAYBACK_SESSION_ID,
    ),
  );
  expect(uncaptionedDecision.pathname).toBe(
    "/video/:/transcode/universal/decision",
  );
  expect(uncaptionedDecision.search).toBe(uncaptionedStart.search);
  expect(fetch.mock.calls[1]![1]).toEqual({
    headers: { Accept: "application/xml" },
  });
});

test("asks Plex for the selected audio stream on remuxed playback", () => {
  const withEnglishAudio: PlexPlaybackPlan = {
    ...TRANSCODE_WITHOUT_SUBTITLES,
    selectedAudioStreamId: 378_571,
  };
  const withFrenchAudio: PlexPlaybackPlan = {
    ...TRANSCODE_WITHOUT_SUBTITLES,
    selectedAudioStreamId: 378_572,
  };

  const english = new URL(
    generatePlexStreamUrl(
      TRANSCODE_ITEM,
      TRANSCODE_ITEM.serverUrl,
      TRANSCODE_ITEM.authToken,
      withEnglishAudio,
      0,
      PLAYBACK_SESSION_ID,
    ),
  );
  const french = new URL(
    generatePlexStreamUrl(
      TRANSCODE_ITEM,
      TRANSCODE_ITEM.serverUrl,
      TRANSCODE_ITEM.authToken,
      withFrenchAudio,
      0,
      PLAYBACK_SESSION_ID,
    ),
  );

  expect(english.searchParams.get("audioStreamID")).toBe("378571");
  expect(french.searchParams.get("audioStreamID")).toBe("378572");
  expect(english.searchParams.get("session")).toBe(
    buildPlexTranscodeSessionKey(PLAYBACK_SESSION_ID, 0, withEnglishAudio),
  );
  expect(french.searchParams.get("session")).toBe(
    buildPlexTranscodeSessionKey(PLAYBACK_SESSION_ID, 0, withFrenchAudio),
  );
  expect(english.searchParams.get("session")).not.toBe(
    french.searchParams.get("session"),
  );
});

test("selects an audio stream on the media part", () => {
  const item = fromPartial<MediaPlayerItem>({
    ...TRANSCODE_ITEM,
    Media: [
      {
        ...TRANSCODE_ITEM.Media?.[0],
        Part: [{ id: 99, key: "/library/parts/99/file.mkv" }],
      },
    ],
  });

  const url = new URL(
    buildPlexAudioSelectionUrl(item, item.serverUrl, item.authToken, 378_571),
  );

  expect(url.pathname).toBe("/library/parts/99");
  expect(url.searchParams.get("audioStreamID")).toBe("378571");
  expect(url.searchParams.get("X-Plex-Token")).toBe("secret-token");
});
