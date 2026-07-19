import { describe, expect, test } from "bun:test";

import { getPlexImagePath, parsePlexImageRequest } from "~/lib/plex-image";
import {
  MAX_PLEX_IMAGE_BYTES,
  handlePlexImageRequest,
  type PlexImageAuthContext,
  type PlexImageRouteDependencies,
} from "~/server/plex-image";

const AUTH_CONTEXT: PlexImageAuthContext = {
  token: "account-token",
  servers: [
    {
      clientIdentifier: "server-1",
      accessToken: "server-token",
      presence: true,
      connections: [
        {
          uri: "https://server.example:32400",
          local: false,
          relay: false,
        },
      ],
    },
  ],
};

function imageRequest(overrides: Record<string, string> = {}): Request {
  const params = new URLSearchParams({
    serverId: "server-1",
    path: "/library/metadata/123/thumb/456",
    width: "320",
    height: "480",
    minSize: "1",
    upscale: "1",
    ...overrides,
  });
  return new Request(`http://localhost/api/plex/image?${params.toString()}`);
}

function dependencies(
  overrides: Partial<PlexImageRouteDependencies> = {},
): PlexImageRouteDependencies {
  return {
    authenticate: () => Promise.resolve(AUTH_CONTEXT),
    fetch: () =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "Content-Type": "image/jpeg",
            "Content-Length": "3",
          },
        }),
      ),
    ...overrides,
  };
}

describe("Plex image request parsing", () => {
  test("preserves public HTTPS metadata artwork outside the PMS proxy", () => {
    expect(
      getPlexImagePath(
        "server-1",
        "https://metadata-static.plex.tv/people/person.jpg",
        { width: 160, height: 160 },
      ),
    ).toBe("https://metadata-static.plex.tv/people/person.jpg");

    expect(
      getPlexImagePath(
        "server-1",
        "https://image.tmdb.org/t/p/original/poster.jpg?language=en",
        { width: 200, height: 300 },
      ),
    ).toBe("https://image.tmdb.org/t/p/original/poster.jpg?language=en");
  });

  test.each([
    "http://metadata-static.plex.tv/people/person.jpg",
    "https://user:password@example.com/poster.jpg",
    "javascript:alert(1)",
  ])("does not render an unsafe absolute artwork URL %s", (path) => {
    expect(
      getPlexImagePath("server-1", path, { width: 160, height: 160 }),
    ).toBeUndefined();
  });

  test("builds a client-safe relative URL and parses allowed artwork", () => {
    const url = getPlexImagePath(
      "server-1",
      "/library/collections/12/composite/34?width=400",
      { width: 440, height: 660 },
    );

    expect(url?.startsWith("/api/plex/image?")).toBe(true);
    const parsed = parsePlexImageRequest(new URL(url!, "http://localhost"));
    expect(parsed).toEqual({
      ok: true,
      value: {
        serverId: "server-1",
        path: "/library/collections/12/composite/34?width=400",
        width: 440,
        height: 660,
        minSize: true,
        upscale: true,
      },
    });
    expect(url).not.toContain("X-Plex-Token");
    expect(url).not.toContain("server.example");
  });

  test.each([
    "https://example.com/poster.jpg",
    "http://127.0.0.1/private.jpg",
    "//127.0.0.1/private.jpg",
    "/library/metadata/1/../../:/prefs",
    "/library/metadata/1/thumb/2\nInjected",
    "/library/metadata/1",
  ])("rejects unsafe or non-artwork path %s", (path) => {
    expect(parsePlexImageRequest(new URL(imageRequest({ path }).url)).ok).toBe(
      false,
    );
  });

  test.each(["0", "2001", "1.5", "NaN", ""])(
    "rejects malformed or out-of-range dimensions: %s",
    (width) => {
      expect(
        parsePlexImageRequest(new URL(imageRequest({ width }).url)).ok,
      ).toBe(false);
    },
  );

  test("rejects repeated and unexpected parameters", () => {
    const repeated = new URL(imageRequest().url);
    repeated.searchParams.append("width", "320");
    expect(parsePlexImageRequest(repeated).ok).toBe(false);

    const unexpected = new URL(imageRequest().url);
    unexpected.searchParams.set("url", "http://127.0.0.1");
    expect(parsePlexImageRequest(unexpected).ok).toBe(false);
  });
});

describe("Plex image route", () => {
  test("requires authentication", async () => {
    const response = await handlePlexImageRequest(
      imageRequest(),
      dependencies({ authenticate: () => Promise.resolve(null) }),
    );
    expect(response.status).toBe(401);
  });

  test("rejects a server outside the signed-in account", async () => {
    const response = await handlePlexImageRequest(
      imageRequest({ serverId: "unknown" }),
      dependencies(),
    );
    expect(response.status).toBe(404);
  });

  test("fetches an authorized image without redirects and returns safe headers", async () => {
    let capturedUrl: URL | undefined;
    let capturedInit: RequestInit | undefined;
    const response = await handlePlexImageRequest(
      imageRequest(),
      dependencies({
        fetch: (input, init) => {
          capturedUrl = new URL(input.toString());
          capturedInit = init;
          return Promise.resolve(
            new Response(new Uint8Array([1, 2, 3]), {
              headers: {
                "Content-Type": "image/jpeg",
                "Content-Length": "3",
              },
            }),
          );
        },
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(3);
    expect(capturedUrl?.origin).toBe("https://server.example:32400");
    expect(capturedUrl?.pathname).toBe("/photo/:/transcode");
    expect(capturedUrl?.searchParams.get("X-Plex-Token")).toBe("server-token");
    expect(capturedUrl?.searchParams.get("url")).toBe(
      "/library/metadata/123/thumb/456?X-Plex-Token=server-token",
    );
    expect(capturedInit?.redirect).toBe("manual");
    expect(response.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("races authorized connections and uses the first successful image", async () => {
    const attemptedOrigins: string[] = [];
    const response = await handlePlexImageRequest(
      imageRequest(),
      dependencies({
        authenticate: () =>
          Promise.resolve({
            token: "account-token",
            servers: [
              {
                clientIdentifier: "server-1",
                accessToken: "server-token",
                presence: true,
                connections: [
                  {
                    uri: "https://local.example:32400",
                    local: true,
                    relay: false,
                  },
                  {
                    uri: "https://remote.example:32400",
                    local: false,
                    relay: false,
                  },
                ],
              },
            ],
          }),
        fetch: (input) => {
          const url = new URL(input);
          attemptedOrigins.push(url.origin);
          if (url.hostname === "remote.example") {
            return Promise.reject(new TypeError("remote connection failed"));
          }
          return Promise.resolve(
            new Response(new Uint8Array([1, 2, 3]), {
              headers: {
                "Content-Type": "image/jpeg",
                "Content-Length": "3",
              },
            }),
          );
        },
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(3);
    expect(new Set(attemptedOrigins)).toEqual(
      new Set(["https://remote.example:32400", "https://local.example:32400"]),
    );
  });

  test("does not wait on a hanging local connection when remote succeeds", async () => {
    const started = Date.now();
    const response = await handlePlexImageRequest(
      imageRequest(),
      dependencies({
        authenticate: () =>
          Promise.resolve({
            token: "account-token",
            servers: [
              {
                clientIdentifier: "server-1",
                accessToken: "server-token",
                presence: true,
                connections: [
                  {
                    uri: "https://local.example:32400",
                    local: true,
                    relay: false,
                  },
                  {
                    uri: "https://remote.example:32400",
                    local: false,
                    relay: false,
                  },
                ],
              },
            ],
          }),
        fetch: (input) => {
          const url = new URL(input);
          if (url.hostname === "local.example") {
            return new Promise(() => undefined);
          }
          return Promise.resolve(
            new Response(new Uint8Array([9, 8, 7]), {
              headers: {
                "Content-Type": "image/jpeg",
                "Content-Length": "3",
              },
            }),
          );
        },
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(3);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test.each([
    [
      "redirect",
      new Response(null, {
        status: 302,
        headers: { Location: "http://127.0.0.1" },
      }),
    ],
    [
      "non-image",
      new Response("secret", { headers: { "Content-Type": "text/plain" } }),
    ],
    [
      "oversized content length",
      new Response(new Uint8Array([1]), {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": (MAX_PLEX_IMAGE_BYTES + 1).toString(),
        },
      }),
    ],
  ])("rejects an upstream %s response", async (_name, upstream) => {
    const response = await handlePlexImageRequest(
      imageRequest(),
      dependencies({ fetch: () => Promise.resolve(upstream) }),
    );
    expect(response.status).toBe(502);
  });

  test("rejects active SVG content and cancels it without forwarding the body", async () => {
    let canceled = false;
    const svgBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("<svg><script>alert(1)</script></svg>"),
        );
      },
      cancel() {
        canceled = true;
      },
    });

    const response = await handlePlexImageRequest(
      imageRequest(),
      dependencies({
        fetch: () =>
          Promise.resolve(
            new Response(svgBody, {
              headers: { "Content-Type": "image/svg+xml" },
            }),
          ),
      }),
    );

    expect(response.status).toBe(502);
    expect(canceled).toBe(true);
    expect(await response.text()).not.toContain("<svg");
  });

  test("aborts a timed-out upstream request", async () => {
    const response = await handlePlexImageRequest(
      imageRequest(),
      dependencies({
        timeoutMs: 1,
        fetch: (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      }),
    );
    expect(response.status).toBe(504);
  });

  test("terminates a streamed response that exceeds the byte limit", async () => {
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_PLEX_IMAGE_BYTES));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const response = await handlePlexImageRequest(
      imageRequest(),
      dependencies({
        fetch: () =>
          Promise.resolve(
            new Response(oversized, {
              headers: { "Content-Type": "image/webp" },
            }),
          ),
      }),
    );

    expect(response.status).toBe(200);
    let rejection: unknown;
    try {
      await response.arrayBuffer();
    } catch (cause) {
      rejection = cause;
    }
    expect(rejection).toHaveProperty(
      "message",
      "Plex image exceeded the byte limit",
    );
  });
});
