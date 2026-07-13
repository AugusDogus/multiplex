import { describe, expect, test } from "bun:test";

import { guestWatchTogetherBootstrapResponseSchema } from "./guest-watch-together-bootstrap";

describe("guestWatchTogetherBootstrapResponseSchema", () => {
  test("normalizes JSON-serialized Plex dates at the guest boundary", () => {
    const parsed = guestWatchTogetherBootstrapResponseSchema.parse({
      ok: true,
      value: {
        room: {
          id: "Room123",
          sourceUri:
            "server://server-1/com.plexapp.plugins.library/library/metadata/42",
          title: "Movie",
          type: "video",
          syncplayHost: "syncplay.example.com",
          syncplayPort: 443,
          users: [
            { id: 1, title: "Host" },
            { id: 2, title: "Guest" },
          ],
        },
        host: { id: 1, title: "Host" },
        guest: { id: 2, title: "Guest" },
        serverId: "server-1",
        serverUrl: "https://example.plex.direct:32400",
        authToken: "transient-token",
        item: {
          ratingKey: "42",
          key: "/library/metadata/42",
          guid: "plex://movie/42",
          title: "Movie",
          type: "movie",
          librarySectionTitle: "Movies",
          librarySectionID: 1,
          librarySectionKey: "/library/sections/1",
          addedAt: "2026-07-13T15:00:00.000Z",
          updatedAt: "2026-07-13T16:00:00.000Z",
          streamPartKey: "/library/parts/42/file.mp4",
        },
      },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.item.addedAt).toEqual(
        new Date("2026-07-13T15:00:00.000Z"),
      );
      expect(parsed.value.item.updatedAt).toEqual(
        new Date("2026-07-13T16:00:00.000Z"),
      );
    }
  });
});
