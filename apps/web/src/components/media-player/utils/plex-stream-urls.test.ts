import { expect, mock, test } from "bun:test";

import { stopTranscodeSession } from "./plex-stream-urls";

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
