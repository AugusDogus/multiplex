import { describe, expect, test } from "bun:test";

import { getPlexImagePath } from "./plex-image";

describe("getPlexImagePath", () => {
  test("preserves public HTTPS metadata artwork", () => {
    expect(
      getPlexImagePath("https://metadata-static.plex.tv/people/person.jpg", {
        width: 160,
        height: 160,
      }),
    ).toBe("https://metadata-static.plex.tv/people/person.jpg");

    expect(
      getPlexImagePath(
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
    expect(getPlexImagePath(path, { width: 160, height: 160 })).toBeUndefined();
  });

  test("builds a direct PMS transcode URL with token", () => {
    const url = getPlexImagePath(
      "/library/collections/12/composite/34?width=400",
      {
        width: 440,
        height: 660,
        serverUrl: "https://server.example:32400",
        authToken: "server-token",
      },
    );

    expect(url).toBeDefined();
    const parsed = new URL(url!);
    expect(parsed.origin).toBe("https://server.example:32400");
    expect(parsed.pathname).toBe("/photo/:/transcode");
    expect(parsed.searchParams.get("width")).toBe("440");
    expect(parsed.searchParams.get("height")).toBe("660");
    expect(parsed.searchParams.get("minSize")).toBe("1");
    expect(parsed.searchParams.get("upscale")).toBe("1");
    expect(parsed.searchParams.get("X-Plex-Token")).toBe("server-token");
    expect(parsed.searchParams.get("url")).toBe(
      "/library/collections/12/composite/34?width=400&X-Plex-Token=server-token",
    );
  });

  test("requires server credentials for PMS artwork paths", () => {
    expect(
      getPlexImagePath("/library/metadata/123/thumb/456", {
        width: 200,
        height: 300,
      }),
    ).toBeUndefined();

    expect(
      getPlexImagePath("/library/metadata/123/thumb/456", {
        width: 200,
        height: 300,
        serverUrl: "https://server.example:32400",
      }),
    ).toBeUndefined();
  });

  test.each([
    "http://127.0.0.1/private.jpg",
    "//127.0.0.1/private.jpg",
    "/library/metadata/1/../../:/prefs",
    "/library/metadata/1/thumb/2\nInjected",
    "/library/metadata/1",
  ])("rejects unsafe or non-artwork path %s", (path) => {
    expect(
      getPlexImagePath(path, {
        width: 160,
        height: 160,
        serverUrl: "https://server.example:32400",
        authToken: "server-token",
      }),
    ).toBeUndefined();
  });
});
