import { describe, expect, test } from "bun:test";

import {
  sanitizeContinueWatchingItem,
  sanitizeHomeHub,
  sanitizeMediaItemDetails,
  sanitizeServer,
  sanitizeServerLibrary,
  stripCredentialsDeep,
} from "./sanitize";

describe("sync-engine sanitize", () => {
  test("persists accessToken on servers for direct PMS access", () => {
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
    expect(row.accessToken).toBe("SECRET_TOKEN");
    expect(row.connections).toHaveLength(1);
  });

  test("persists authToken and serverUrl on continue watching items", () => {
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
    expect(row.authToken).toBe("CW_SECRET");
    expect(row.serverUrl).toBe("https://pms.example");
    expect(row.listIndex).toBeNull();
  });

  test("persists listIndex for continue watching carousel order", () => {
    const row = sanitizeContinueWatchingItem(
      {
        serverId: "haus-1",
        ratingKey: "100",
        title: "Episode",
      },
      { listIndex: 3 },
    );

    expect(row.listIndex).toBe(3);
  });

  test("persists hub item credentials", () => {
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
          authToken: "HUB_SECRET",
          serverUrl: "https://pms.example",
        },
        { title: "Missing rating key should drop" },
      ],
    });

    expect(row.id).toBe("haus-1:/hubs/home/recentlyAdded");
    expect(row.title).toBe("Recently Added");
    expect(row.items).toHaveLength(1);
    expect(row.items[0]?.ratingKey).toBe("1");
    expect(row.items[0]?.authToken).toBe("HUB_SECRET");
    expect(row.items[0]?.serverUrl).toBe("https://pms.example");
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

  test("persists credentials on item details payloads", () => {
    const row = sanitizeMediaItemDetails(
      {
        serverName: "Haus",
        authToken: "DETAILS_SECRET",
        serverUrl: "https://pms.example",
        playTarget: { ratingKey: "55", title: "Inception" },
        children: [],
        playableChildren: [],
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

    expect(row?.id).toBe("haus-1:55");
    expect(row?.title).toBe("Inception");
    // Default is fail-closed when options.hasFullDetails is omitted.
    expect(row?.hasFullDetails).toBe(false);
    expect(row?.authToken).toBe("DETAILS_SECRET");
    expect(row?.serverUrl).toBe("https://pms.example");
    expect(row?.item).toMatchObject({
      ratingKey: "55",
      title: "Inception",
    });

    const full = sanitizeMediaItemDetails(
      {
        serverName: "Haus",
        playTarget: null,
        children: [],
        playableChildren: [],
        item: { ratingKey: "55", type: "movie", title: "Inception" },
      },
      "haus-1",
      { hasFullDetails: true },
    );
    expect(full?.hasFullDetails).toBe(true);
  });

  test("deep clone keeps nested credentials for direct PMS access", () => {
    const playlistPayload = stripCredentialsDeep({
      ratingKey: "9",
      items: [
        {
          serverId: "haus-1",
          ratingKey: "1",
          authToken: "PLAYLIST_SECRET",
          serverUrl: "https://pms.example",
        },
      ],
    }) as {
      items: Array<{ authToken?: string; serverUrl?: string }>;
    };

    expect(playlistPayload.items[0]?.authToken).toBe("PLAYLIST_SECRET");
    expect(playlistPayload.items[0]?.serverUrl).toBe("https://pms.example");
  });
});
