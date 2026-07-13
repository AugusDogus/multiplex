import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

import { PlexServerClient } from "./plex-server-client";

const CONFIG = {
  product: "Multiplex Test",
  version: "1.0.0",
  clientIdentifier: "multiplex-test-client",
  platform: "Web",
};

function createFetchMock(
  implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
  return Object.assign(mock(implementation), {
    preconnect: mock((_url: string | URL) => undefined),
  });
}

afterEach(() => {
  mock.restore();
});

describe("PlexServerClient.issueTransientToken", () => {
  test("requests a full-scope delegation token and returns only its value", async () => {
    const request = createFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/security/token");
      expect(url.searchParams.get("type")).toBe("delegation");
      expect(url.searchParams.get("scope")).toBe("all");
      expect(url.searchParams.get("X-Plex-Token")).toBe("durable-guest-token");
      expect(init?.method).toBe("POST");
      return Response.json({
        MediaContainer: { token: "transient-guest-token" },
      });
    });
    spyOn(globalThis, "fetch").mockImplementation(request);
    const client = PlexServerClient.fromConnectionUri(
      "server-id",
      "https://example.plex.direct:32400",
      "durable-guest-token",
      CONFIG,
    );

    const token = await client.issueTransientToken();

    expect(token).toBe("transient-guest-token");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
