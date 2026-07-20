import { describe, expect, test } from "bun:test";

import {
  rowContainsCredentialFields,
  sanitizeContinueWatchingItem,
  sanitizeHomeHub,
  sanitizeMediaItemDetails,
  sanitizeServer,
  sanitizeServerLibrary,
} from "./sanitize";

describe("sync-engine sanitize", () => {
  test("strips accessToken from servers while keeping connection hosts", () => {
    const row = sanitizeServer({
      name: "Haus",
      product: "Plex Media Server",
      productVersion: "1.0",
      platform: "Linux",
      platformVersion: "6",
      device: "PC",
      clientIdentifier: "haus-1",
      createdAt: "1",
      lastSeenAt: "2",
      provides: "server",
      publicAddress: "1.2.3.4",
      accessToken: "SECRET_TOKEN",
      owned: true,
      home: true,
      synced: false,
      relay: true,
      presence: true,
      httpsRequired: false,
      connections: [
        {
          protocol: "https",
          address: "192.168.1.10",
          port: 32400,
          uri: "https://192.168.1.10:32400",
          local: true,
          relay: false,
        },
      ],
    });

    expect(row.id).toBe("haus-1");
    expect(row.connections).toHaveLength(1);
    expect(
      rowContainsCredentialFields(row as unknown as Record<string, unknown>),
    ).toEqual([]);
    expect(JSON.stringify(row)).not.toContain("SECRET_TOKEN");
  });

  test("strips authToken from continue watching items", () => {
    const row = sanitizeContinueWatchingItem({
      serverId: "haus-1",
      serverName: "Haus",
      ratingKey: "100",
      title: "Episode",
      grandparentTitle: "Show",
      authToken: "CW_SECRET",
      serverUrl: "https://pms.example",
      progressPercent: 42,
      isCompleted: false,
      hubTitle: "Continue Watching",
      hubType: "mixed",
    });

    expect(row.id).toBe("haus-1:100");
    expect(row.title).toBe("Episode");
    expect(row.progressPercent).toBe(42);
    expect(JSON.stringify(row)).not.toContain("CW_SECRET");
    expect(JSON.stringify(row)).not.toContain("https://pms.example");
    expect(
      rowContainsCredentialFields(row as unknown as Record<string, unknown>),
    ).toEqual([]);
  });

  test("compacts hub items without server credentials", () => {
    const row = sanitizeHomeHub({
      serverId: "haus-1",
      key: "/hubs/home/recentlyAdded",
      title: "Recently Added",
      type: "movie",
      hubIdentifier: "home.movies.recent",
      size: 2,
      items: [
        {
          ratingKey: "1",
          title: "Movie A",
          type: "movie",
          thumb: "/thumb/1",
          year: 2020,
          authToken: "NOPE",
        },
        { title: "Missing rating key should drop" },
      ],
    });

    expect(row.id).toBe("haus-1:/hubs/home/recentlyAdded");
    expect(row.title).toBe("Recently Added");
    expect(row.items).toHaveLength(1);
    expect(row.items[0]?.ratingKey).toBe("1");
    expect(row.items[0]?.title).toBe("Movie A");
    expect(JSON.stringify(row)).not.toContain("NOPE");
  });

  test("keeps mediaProviders and extracts numeric library directories", () => {
    const mediaProviders = {
      MediaContainer: {
        MediaProvider: [
          {
            Feature: [
              {
                Directory: [
                  {
                    id: "1",
                    key: "/library/sections/1",
                    title: "Movies",
                    type: "movie",
                  },
                  {
                    id: "live",
                    key: "/livetv",
                    title: "Live TV",
                    type: "live",
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const row = sanitizeServerLibrary({
      serverId: "haus-1",
      serverName: "Haus",
      serverOwned: true,
      mediaProviders,
    });

    expect(row.mediaProviders).toEqual(mediaProviders);
    expect(row.libraries).toEqual([
      {
        id: "1",
        key: "/library/sections/1",
        title: "Movies",
        type: "movie",
      },
    ]);
  });

  test("sanitizes item details payloads", () => {
    const row = sanitizeMediaItemDetails(
      {
        serverName: "Haus",
        authToken: "DETAILS_SECRET",
        item: {
          ratingKey: "55",
          type: "movie",
          title: "Inception",
          summary: "Dreams",
          year: 2010,
        },
      },
      "haus-1",
    );

    expect(row).toEqual({
      id: "haus-1:55",
      serverId: "haus-1",
      serverName: "Haus",
      ratingKey: "55",
      type: "movie",
      title: "Inception",
      summary: "Dreams",
      thumb: null,
      art: null,
      year: 2010,
      duration: null,
      viewOffset: null,
      viewCount: null,
      leafCount: null,
      childCount: null,
    });
    expect(JSON.stringify(row)).not.toContain("DETAILS_SECRET");
  });
});
