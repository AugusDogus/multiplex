import {
  continueWatchingResponseSchema,
  itemMetadataResponseSchema,
  metadataChildrenResponseSchema,
  type ContinueWatchingResponse,
  type ItemMetadata,
  type ItemMetadataChild,
} from "../schemas/continue-watching-schemas";
import {
  hubResponseSchema,
  libraryContentResponseSchema,
  type HubResponse,
  type LibraryContentResponse,
} from "../schemas/hub-schemas";
import {
  categoriesResponseSchema,
  filterValuesResponseSchema,
  libraryMetaResponseSchema,
  type CategoriesResponse,
  type FilterValuesResponse,
  type LibraryMetaResponse,
  type LibrarySectionPivots,
} from "../schemas/library-browse-schemas";
import { assertAllowedHubKey } from "../utils/hub-key-utils";
import { HUB_PAGE_SIZE, HUB_PREVIEW_SIZE, LIBRARY_PAGE_SIZE } from "../../constants/pagination";
import { dvrsResponseSchema, type DVRsResponse } from "../schemas/dvr-schemas";
import {
  channelsResponseSchema,
  gridResponseSchema,
  type ChannelsResponse,
  type GridParams,
  type GridResponse,
} from "../schemas/grid-schemas";
import {
  playQueueResponseSchema,
  type CreatePlayQueueParams,
  type PlayQueueResponse,
} from "../schemas/play-queue-schemas";
import {
  playlistsResponseSchema,
  type Playlist,
  type PlaylistType,
  type PlaylistsResponse,
} from "../schemas/playlist-schemas";
import { MediaContainerSchema, type MediaContainer } from "../schemas/plex-server-schemas";
import type { PlexDevice } from "../schemas/plex-tv-schemas";
import {
  searchResponseSchema,
  type SearchParams,
  type SearchResponse,
} from "../schemas/search-schemas";
import {
  PlexAPIError,
  type GetRequestOptions,
  type PlexConfig,
  type PostRequestOptions,
  type PutRequestOptions,
} from "../types/client-types";

/* ────────────────────────────────────────────────────────────
   Plex Server Client
   Client for interacting with individual Plex Media Server instances
   ──────────────────────────────────────────────────────────── */

/** Cold starts (fresh browser + server) often need longer than LAN latency. */
const CONNECTION_TEST_TIMEOUT_MS = 3_000;

function createConnectionFromUri(uri: string): PlexDevice["connections"][0] {
  const parsedUrl = new URL(uri);

  return {
    protocol: parsedUrl.protocol.replace(":", ""),
    address: parsedUrl.hostname,
    port:
      parsedUrl.port.length > 0
        ? Number.parseInt(parsedUrl.port, 10)
        : parsedUrl.protocol === "https:"
          ? 443
          : 80,
    uri: uri.endsWith("/") ? uri.slice(0, -1) : uri,
    local: parsedUrl.hostname === "localhost" || parsedUrl.hostname === "127.0.0.1",
    relay: false,
    IPv6: parsedUrl.hostname.includes(":"),
  };
}

/**
 * Client for interacting with individual Plex Media Server instances
 */
export class PlexServerClient {
  private readonly token: string;
  private readonly config: PlexConfig;
  private readonly server: PlexDevice;
  private workingConnection: PlexDevice["connections"][0] | null = null;
  private connectionTestPromise: Promise<PlexDevice["connections"][0]> | null = null;

  /**
   * @param server - Plex Media Server device information
   * @param token - Plex authentication token
   * @param config - Client configuration
   */
  constructor(server: PlexDevice, token: string, config: PlexConfig) {
    // Use server's specific access token if available, otherwise fall back to user token
    this.token = server.accessToken ?? token;
    this.config = config;
    this.server = server;
  }

  static fromConnectionUri(
    serverId: string,
    connectionUri: string,
    token: string,
    config: PlexConfig,
  ): PlexServerClient {
    const connection = createConnectionFromUri(connectionUri);
    const server: PlexDevice = {
      name: "Plex Media Server",
      product: "Plex Media Server",
      productVersion: "",
      platform: "",
      platformVersion: "",
      device: "",
      clientIdentifier: serverId,
      createdAt: "",
      lastSeenAt: "",
      provides: "server",
      ownerId: null,
      sourceTitle: null,
      publicAddress: connection.address,
      accessToken: token,
      owned: true,
      home: false,
      synced: false,
      relay: false,
      presence: true,
      httpsRequired: connection.protocol === "https",
      publicAddressMatches: false,
      connections: [connection],
    };
    const client = new PlexServerClient(server, token, config);
    client.workingConnection = connection;

    return client;
  }

  /**
   * Test a connection to see if it's working
   * @param connection - Connection to test
   * @returns Promise that resolves if connection works, rejects if not
   */
  private async testConnection(connection: PlexDevice["connections"][0]): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONNECTION_TEST_TIMEOUT_MS);

      const testUrl = `${connection.uri}/identity`;

      const response = await fetch(testUrl, {
        method: "GET",
        headers: {
          "X-Plex-Token": this.token,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Find the best working connection by testing them in priority order
   * @returns Promise that resolves to a working connection
   */
  private async findWorkingConnection(): Promise<PlexDevice["connections"][0]> {
    // If we already have a cached working connection, return it
    if (this.workingConnection) {
      return this.workingConnection;
    }

    // If we're already testing connections, return that promise
    if (this.connectionTestPromise) {
      return this.connectionTestPromise;
    }

    // Start testing connections
    this.connectionTestPromise = this.testConnections();

    try {
      const connection = await this.connectionTestPromise;
      this.workingConnection = connection;
      return connection;
    } finally {
      // Clear the promise so we can retry if needed
      this.connectionTestPromise = null;
    }
  }

  /**
   * Test all connections in priority order until we find one that works
   */
  private async testConnections(): Promise<PlexDevice["connections"][0]> {
    const connections = [...this.server.connections];

    console.log(
      `Testing connections for server: ${this.server.name} (${connections.length} available)`,
    );

    // Sort connections by priority
    connections.sort((a, b) => {
      // For shared servers (not owned), prefer relay connections first
      if (!this.server.owned) {
        if (a.relay && !b.relay) return -1;
        if (!a.relay && b.relay) return 1;
      }

      // For owned servers, local connections first
      if (this.server.owned) {
        if (a.local && !b.local) return -1;
        if (!a.local && b.local) return 1;
      }

      // Among same type, prefer HTTPS
      if (a.protocol === "https" && b.protocol === "http") return -1;
      if (a.protocol === "http" && b.protocol === "https") return 1;

      return 0;
    });

    // Test connections in parallel with a slight delay between batches
    // to avoid overwhelming the server
    const batchSize = 3;
    const batchCount = Math.ceil(connections.length / batchSize);

    for (const batchIndex of Array.from({ length: batchCount }, (_, i) => i)) {
      const startIndex = batchIndex * batchSize;
      const batch = connections.slice(startIndex, startIndex + batchSize);

      // Test this batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (connection) => {
          const works = await this.testConnection(connection);
          return { connection, works };
        }),
      );

      // Return the first working connection from this batch
      for (const result of results) {
        if (result.status === "fulfilled" && result.value.works) {
          console.log(`✅ ${this.server.name}: Connected via ${result.value.connection.uri}`);
          return result.value.connection;
        }
      }

      // Small delay before trying the next batch
      if (startIndex + batchSize < connections.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(`❌ ${this.server.name}: No working connections found`);
    throw new Error(`No working connections found for server ${this.server.name}`);
  }

  /**
   * Reset the cached connection (useful when current connection stops working)
   */
  private resetConnection(): void {
    this.workingConnection = null;
    this.connectionTestPromise = null;
  }

  /**
   * Send timeline update to the server
   * @param params - Timeline parameters including ratingKey, state, playbackTime, etc.
   * @returns Promise that resolves when timeline is sent
   */
  async sendTimeline(params: {
    ratingKey: string;
    key: string;
    playQueueItemID?: string;
    playbackTime: number;
    time: number;
    duration: number;
    state: "playing" | "paused" | "buffering" | "stopped";
    hasMDE?: number;
    context?: string;
    sessionId: string;
  }): Promise<void> {
    const timelineParams = {
      ratingKey: params.ratingKey,
      key: params.key,
      playbackTime: params.playbackTime.toString(),
      time: params.time.toString(),
      duration: params.duration.toString(),
      state: params.state,
      ...(params.playQueueItemID && {
        playQueueItemID: params.playQueueItemID,
      }),
      ...(params.hasMDE && { hasMDE: params.hasMDE.toString() }),
      ...(params.context && { context: params.context }),
    };

    await this.get({
      endpoint: ":/timeline",
      params: timelineParams,
      xPlexOverrides: {
        playbackSessionId: params.sessionId,
      },
    });
  }

  /**
   * Get media providers for this server
   * @returns Media providers information with proper typing
   */
  async getMediaProviders(): Promise<MediaContainer> {
    return await this.get({
      endpoint: "media/providers",
      schema: MediaContainerSchema,
    });
  }

  /**
   * Get library sections (libraries) for this server
   * @returns Library sections information
   */
  async getLibrarySections<T = unknown>(): Promise<T> {
    return await this.get({
      endpoint: "library/sections",
    });
  }

  private buildHubQueryParams(options?: {
    count?: number;
    onlyTransient?: boolean;
    contentDirectoryIds?: string[];
  }): Record<string, string> {
    const queryParams: Record<string, string> = {
      includeMeta: "1",
      count: (options?.count ?? HUB_PREVIEW_SIZE).toString(),
    };

    if (options?.onlyTransient) {
      queryParams.onlyTransient = "1";
    }

    if (options?.contentDirectoryIds?.length) {
      queryParams.contentDirectoryID = options.contentDirectoryIds.join(",");
    }

    return queryParams;
  }

  private parseHubResponse(rawResponse: unknown): HubResponse {
    const parsed = hubResponseSchema.parse(rawResponse);
    return {
      ...parsed,
      serverId: this.server.clientIdentifier,
    };
  }

  /**
   * Get global hubs (home screen sections like recently added movies/TV)
   */
  async getHubs(params?: {
    count?: number;
    onlyTransient?: boolean;
    contentDirectoryIds?: string[];
  }): Promise<HubResponse> {
    const rawResponse = await this.get({
      endpoint: "hubs",
      params: this.buildHubQueryParams(params),
    });

    return this.parseHubResponse(rawResponse);
  }

  /**
   * Get hubs for a specific library section (recently added, recently released, etc.)
   */
  async getSectionHubs(
    sectionId: string,
    params?: { count?: number; onlyTransient?: boolean },
  ): Promise<HubResponse> {
    const rawResponse = await this.get({
      endpoint: `hubs/sections/${sectionId}`,
      params: this.buildHubQueryParams({
        ...params,
        onlyTransient: params?.onlyTransient ?? true,
      }),
    });

    return this.parseHubResponse(rawResponse);
  }

  /**
   * Fetch the full contents of a hub using its Plex `key` (e.g.
   * `/hubs/home/recentlyAdded?type=1` or `/library/sections/1/all?sort=addedAt:desc`).
   */
  async getHubContent(
    hubKey: string,
    params?: {
      start?: number;
      size?: number;
    },
  ): Promise<LibraryContentResponse> {
    const parsed = assertAllowedHubKey(hubKey);
    const queryParams: Record<string, string> = {
      includeMeta: "1",
      ...parsed.params,
      "X-Plex-Container-Start": (params?.start ?? 0).toString(),
      "X-Plex-Container-Size": (params?.size ?? HUB_PAGE_SIZE).toString(),
    };

    const rawResponse = await this.get({
      endpoint: parsed.endpoint,
      params: queryParams,
    });

    return libraryContentResponseSchema.parse(rawResponse);
  }

  /**
   * Get library content by section ID with pagination, sorting, a content
   * `type` pivot (movie/show/season/episode), and arbitrary tag/boolean
   * filters (e.g. `genre`, `year`, `unwatchedLeaves`).
   */
  async getLibraryContent(
    sectionId: string,
    params?: {
      sort?: string;
      start?: number;
      size?: number;
      type?: string;
      filters?: Record<string, string>;
    },
  ): Promise<LibraryContentResponse> {
    const queryParams: Record<string, string> = {
      sort: params?.sort ?? "addedAt:desc",
      "X-Plex-Container-Start": (params?.start ?? 0).toString(),
      "X-Plex-Container-Size": (params?.size ?? LIBRARY_PAGE_SIZE).toString(),
    };

    if (params?.type) {
      queryParams.type = params.type;
    }

    if (params?.filters) {
      for (const [key, value] of Object.entries(params.filters)) {
        // Guard against callers smuggling Plex control params (pagination,
        // auth) in through the filter bag.
        if (value !== "" && !key.startsWith("X-Plex-")) {
          queryParams[key] = value;
        }
      }
    }

    const rawResponse = await this.get({
      endpoint: `library/sections/${sectionId}/all`,
      params: queryParams,
    });

    return libraryContentResponseSchema.parse(rawResponse);
  }

  /**
   * Get the filter/sort metadata for a library section. Drives the Library
   * tab's type, filter, and sort dropdown menus.
   */
  async getLibraryMeta(sectionId: string, type?: string): Promise<LibraryMetaResponse> {
    const queryParams: Record<string, string> = {
      includeMeta: "1",
      "X-Plex-Container-Size": "0",
    };

    if (type) {
      queryParams.type = type;
    }

    const rawResponse = await this.get({
      endpoint: `library/sections/${sectionId}/all`,
      params: queryParams,
    });

    return libraryMetaResponseSchema.parse(rawResponse);
  }

  /**
   * Get the collections for a library section (the Collections tab).
   */
  async getCollections(
    sectionId: string,
    params?: { start?: number; size?: number },
  ): Promise<LibraryContentResponse> {
    const queryParams: Record<string, string> = {
      "X-Plex-Container-Start": (params?.start ?? 0).toString(),
      "X-Plex-Container-Size": (params?.size ?? LIBRARY_PAGE_SIZE).toString(),
    };

    const rawResponse = await this.get({
      endpoint: `library/sections/${sectionId}/collections`,
      params: queryParams,
    });

    return libraryContentResponseSchema.parse(rawResponse);
  }

  /**
   * Get the categories (genre/tag tiles) for a library section (the
   * Categories tab).
   */
  async getCategories(
    sectionId: string,
    params?: { start?: number; size?: number },
  ): Promise<CategoriesResponse> {
    const queryParams: Record<string, string> = {
      "X-Plex-Container-Start": (params?.start ?? 0).toString(),
      "X-Plex-Container-Size": (params?.size ?? LIBRARY_PAGE_SIZE).toString(),
    };

    const rawResponse = await this.get({
      endpoint: `library/sections/${sectionId}/categories`,
      params: queryParams,
    });

    return categoriesResponseSchema.parse(rawResponse);
  }

  /**
   * Get the playlists associated with a library section (the Playlists tab).
   */
  async getPlaylists(
    sectionId: string,
    params?: { start?: number; size?: number },
  ): Promise<LibraryContentResponse> {
    const queryParams: Record<string, string> = {
      sectionID: sectionId,
      "X-Plex-Container-Start": (params?.start ?? 0).toString(),
      "X-Plex-Container-Size": (params?.size ?? LIBRARY_PAGE_SIZE).toString(),
    };

    const rawResponse = await this.get({
      endpoint: "playlists",
      params: queryParams,
    });

    return libraryContentResponseSchema.parse(rawResponse);
  }

  /**
   * Get the possible values for a tag-based library filter (e.g. the list of
   * genres for the Genre filter). `filterPath` is the filter's `key` from the
   * library metadata, e.g. `/library/sections/4/genre?type=2`.
   */
  async getFilterValues(
    filterPath: string,
    params?: { start?: number; size?: number },
  ): Promise<FilterValuesResponse> {
    const questionIndex = filterPath.indexOf("?");
    const path = questionIndex === -1 ? filterPath : filterPath.slice(0, questionIndex);
    const query = questionIndex === -1 ? "" : filterPath.slice(questionIndex + 1);
    const endpoint = path.startsWith("/") ? path.slice(1) : path;

    // Carry through only the filter's own query params (e.g. `type=2`); drop
    // any Plex control params so the caller can't override pagination/auth.
    const passthroughParams = Object.fromEntries(
      [...new URLSearchParams(query)].filter(([key]) => !key.startsWith("X-Plex-")),
    );

    const queryParams: Record<string, string> = {
      ...passthroughParams,
      "X-Plex-Container-Start": (params?.start ?? 0).toString(),
      "X-Plex-Container-Size": (params?.size ?? 200).toString(),
    };

    const rawResponse = await this.get({
      endpoint,
      params: queryParams,
    });

    return filterValuesResponseSchema.parse(rawResponse);
  }

  /**
   * Derive the browsable pivots (tabs) for a library section from the media
   * providers payload, e.g. Recommended, Library, Collections, Categories.
   * Also returns the section's display title (the directory carries it, so the
   * caller avoids a separate request just to label the page).
   */
  async getLibraryPivots(sectionId: string): Promise<LibrarySectionPivots> {
    const providers = await this.getMediaProviders();

    for (const provider of providers.MediaContainer.MediaProvider) {
      for (const feature of provider.Feature) {
        if (!feature.Directory) {
          continue;
        }

        for (const directory of feature.Directory) {
          if (
            "id" in directory &&
            directory.id === sectionId &&
            "Pivot" in directory &&
            directory.Pivot
          ) {
            return {
              title: directory.title,
              pivots: directory.Pivot.map((pivot) => ({
                id: pivot.id,
                type: pivot.type,
                key: pivot.key,
                title: pivot.title,
                symbol: pivot.symbol,
                context: pivot.context,
              })),
            };
          }
        }
      }
    }

    return { title: undefined, pivots: [] };
  }

  /**
   * Fetch detailed metadata for a single library item. Unlike
   * `hubs/continueWatching`, this returns expanded `Media[].Part[].Stream[]`
   * arrays, which the player needs to populate audio and subtitle menus.
   *
   * @param ratingKey - Plex `ratingKey` of the item to fetch
   * @returns Parsed metadata item, or `null` when the response is empty.
   */
  async getItemMetadata(ratingKey: string): Promise<ItemMetadata | null> {
    // Parsed manually because `itemMetadataResponseSchema` uses Zod transforms
    // (`UnixSeconds` → `Date`) which break the invariant `z.ZodType<T>`
    // inference used by the `get` helper.
    const rawResponse = await this.get({
      endpoint: `library/metadata/${ratingKey}`,
      params: {
        includeChapters: "1",
        includeMarkers: "1",
        includeExternalMedia: "1",
      },
    });

    const parsed = itemMetadataResponseSchema.parse(rawResponse);
    return parsed.MediaContainer.Metadata?.[0] ?? null;
  }

  /**
   * Fetch child metadata for container items. Shows return seasons, and
   * seasons return episodes.
   *
   * @param ratingKey - Plex `ratingKey` of the show or season to expand
   * @returns Parsed child metadata items.
   */
  async getMetadataChildren(ratingKey: string): Promise<ItemMetadataChild[]> {
    const rawResponse = await this.get({
      endpoint: `library/metadata/${ratingKey}/children`,
    });

    const parsed = metadataChildrenResponseSchema.parse(rawResponse);
    return parsed.MediaContainer.Metadata ?? [];
  }

  async markItemWatched(ratingKey: string): Promise<void> {
    await this.setItemWatchedState(ratingKey, true);
  }

  async markItemUnwatched(ratingKey: string): Promise<void> {
    await this.setItemWatchedState(ratingKey, false);
  }

  private async setItemWatchedState(ratingKey: string, watched: boolean): Promise<void> {
    await this.get({
      endpoint: watched ? ":/scrobble" : ":/unscrobble",
      params: {
        identifier: "com.plexapp.plugins.library",
        key: ratingKey,
      },
      expectEmptyResponse: true,
    });
  }

  /**
   * Get Continue Watching data for specific library directories
   * @param contentDirectoryIds - Array of library section IDs to include
   * @returns Continue Watching response with progress and metadata
   */
  async getContinueWatching(contentDirectoryIds: string[]): Promise<ContinueWatchingResponse> {
    if (contentDirectoryIds.length === 0) {
      // Return empty response if no directories specified
      return {
        serverId: this.server.clientIdentifier,
        totalSize: 0,
        allowSync: false,
        hubs: [],
        items: [],
      };
    }

    // Get raw response from Plex API (without schema validation to avoid date transformation issues)
    const rawResponse = await this.get({
      endpoint: "hubs/continueWatching",
      params: {
        contentDirectoryID: contentDirectoryIds.join(","),
      },
    });

    // Transform to our processed response format and ensure correct serverId
    const parsedResponse = continueWatchingResponseSchema.parse(rawResponse);

    // Override serverId to ensure it matches our server's clientIdentifier
    return {
      ...parsedResponse,
      serverId: this.server.clientIdentifier,
      items: parsedResponse.items.map((item) => ({
        ...item,
        serverId: this.server.clientIdentifier,
      })),
    };
  }

  /**
   * Get Continue Watching data for all libraries on this server
   * @returns Continue Watching response for all available libraries
   */
  async getAllContinueWatching(): Promise<ContinueWatchingResponse> {
    try {
      // First get all library sections to build the directory list
      const mediaProviders = await this.getMediaProviders();

      // Extract library directory IDs from the MediaProvider structure
      const libraryDirectoryIds: string[] = [];

      for (const provider of mediaProviders.MediaContainer.MediaProvider) {
        for (const feature of provider.Feature) {
          if (feature.Directory) {
            for (const directory of feature.Directory) {
              // Look for library sections (directories with numeric IDs)
              if ("id" in directory && directory.id && !isNaN(Number(directory.id))) {
                libraryDirectoryIds.push(directory.id);
              }
            }
          }
        }
      }

      return await this.getContinueWatching(libraryDirectoryIds);
    } catch (error) {
      console.warn(`Failed to get all Continue Watching for ${this.server.name}:`, error);
      // Return empty response on error
      return {
        serverId: this.server.clientIdentifier,
        totalSize: 0,
        allowSync: false,
        hubs: [],
        items: [],
      };
    }
  }

  /**
   * Search media across this server's libraries
   * @param params - Search parameters including query, limit, searchTypes, etc.
   * @returns Search response with results and metadata
   */
  async search(params: SearchParams): Promise<SearchResponse> {
    const searchParams: Record<string, string> = {
      query: params.query,
      limit: params.limit?.toString() ?? "50",
      searchTypes: params.searchTypes?.join(",") ?? "movies,music,people,tv",
      includeCollections: params.includeCollections ? "1" : "0",
      includeExternalMedia: params.includeExternalMedia ? "1" : "0",
    };

    // Get raw response first to debug schema issues
    const rawResponse = await this.get({
      endpoint: "/library/search",
      params: searchParams,
    });

    // Parse with schema
    try {
      return searchResponseSchema.parse(rawResponse);
    } catch (error) {
      console.error(`Search schema validation failed for ${this.server.name}:`, error);
      throw error;
    }
  }

  /**
   * Get EPG grid data for a specific channel and date
   * @param params - Grid parameters including channelGridKey and date
   * @returns Grid response with program schedule data
   */
  async getGrid(params: GridParams): Promise<GridResponse> {
    const gridParams = {
      channelGridKey: params.channelGridKey,
      date: params.date,
    };

    const providerIdentifier = params.providerIdentifier ?? "tv.plex.providers.epg.xmltv:71";

    return await this.get({
      endpoint: `/${providerIdentifier}/grid`,
      params: gridParams,
      schema: gridResponseSchema,
    });
  }

  /**
   * Get available EPG channels from the DVR lineup
   * @param providerIdentifier - The EPG provider identifier (e.g., "tv.plex.providers.epg.xmltv:71")
   * @returns Channels response with available channel information
   */
  async getChannels(
    providerIdentifier = "tv.plex.providers.epg.xmltv:71",
  ): Promise<ChannelsResponse> {
    return await this.get({
      endpoint: `/${providerIdentifier}/lineups/dvr/channels`,
      schema: channelsResponseSchema,
    });
  }

  /**
   * Get all DVRs from the server
   * @returns Promise that resolves to DVRs response with all available DVRs
   */
  async getDVRs(): Promise<DVRsResponse> {
    return await this.get({
      endpoint: `/livetv/dvrs`,
      schema: dvrsResponseSchema,
    });
  }

  /**
   * Reload the EPG guide data for a specific DVR
   * @param dvrId - The DVR ID to reload guide for
   * @returns Promise that resolves when guide reload is complete
   */
  async reloadGuide(dvrId: string): Promise<void> {
    await this.post({
      endpoint: `/livetv/dvrs/${dvrId}/reloadGuide`,
      expectEmptyResponse: true,
    });
  }

  /**
   * Reload the EPG guide data for all DVRs
   * @returns Promise that resolves when all guide reloads are complete
   */
  async reloadAllGuides(): Promise<void> {
    const dvrsResponse = await this.getDVRs();
    const reloadPromises = dvrsResponse.MediaContainer.Dvr.map((dvr) => this.reloadGuide(dvr.key));
    await Promise.all(reloadPromises);
  }

  /**
   * Create a play queue with markers
   * @param params - Parameters for creating the play queue
   * @returns Play queue response with markers
   */
  async createPlayQueue(params: CreatePlayQueueParams): Promise<PlayQueueResponse> {
    const queryParams = {
      type: params.type,
      uri: params.uri,
      continuous: params.continuous ? "1" : "0",
      includeMarkers: params.includeMarkers ? "1" : "0",
      includeChapters: params.includeChapters ? "1" : "0",
      shuffle: params.shuffle ? "1" : "0",
      repeat: params.repeat.toString(),
      own: "1",
      includeGeolocation: "1",
      includeExternalMedia: "1",
    };

    return await this.post({
      endpoint: "playQueues",
      params: queryParams,
      schema: playQueueResponseSchema,
    });
  }

  async updatePlayQueue(params: {
    playQueueId: string;
    type: CreatePlayQueueParams["type"];
    uri: string;
    next?: boolean;
    shuffle?: boolean;
  }): Promise<PlayQueueResponse> {
    return await this.put({
      endpoint: `playQueues/${params.playQueueId}`,
      params: {
        type: params.type,
        uri: params.uri,
        ...(params.next ? { next: "1" } : {}),
        ...(params.shuffle === undefined ? {} : { shuffle: params.shuffle ? "1" : "0" }),
      },
      schema: playQueueResponseSchema,
    });
  }

  /**
   * Get play queue by ID with markers
   * @param playQueueId - The play queue ID to retrieve
   * @param includeMarkers - Whether to include markers in the response
   * @returns Play queue response with markers
   */
  async getPlayQueue(playQueueId: string, includeMarkers = true): Promise<PlayQueueResponse> {
    return await this.get({
      endpoint: `playQueues/${playQueueId}`,
      params: {
        includeMarkers: includeMarkers ? "1" : "0",
        includeChapters: "1",
        own: "1",
      },
      schema: playQueueResponseSchema,
    });
  }

  /**
   * List the user's playlists filtered to a single `playlistType` (the buckets
   * Plex Web shows in its "Add to..." picker). Smart playlists are returned too
   * but can't be appended to, so callers filter them out.
   *
   * @param playlistType - `video`, `audio`, or `photo`
   * @returns Playlists of the requested type
   */
  async getPlaylistsByType(playlistType: PlaylistType): Promise<Playlist[]> {
    const response = await this.get({
      endpoint: "playlists",
      params: {
        playlistType,
      },
      schema: playlistsResponseSchema,
    });

    return response.MediaContainer.Metadata ?? [];
  }

  /**
   * Append an item to an existing playlist.
   *
   * Mirrors Plex Web: `PUT /playlists/{playlistRatingKey}/items?uri=<serverUri>`
   * where `serverUri` points at the source item on this server.
   *
   * @returns The playlist container, including `leafCountAdded`.
   */
  async addItemToPlaylist(playlistRatingKey: string, uri: string): Promise<PlaylistsResponse> {
    return await this.put({
      endpoint: `playlists/${playlistRatingKey}/items`,
      params: { uri },
      schema: playlistsResponseSchema,
    });
  }

  /**
   * Create a new (dumb) playlist seeded with a single item.
   *
   * Mirrors Plex Web: `POST /playlists?type=<video|audio|photo>&title=<title>&smart=0&uri=<serverUri>`.
   *
   * @returns The created playlist container, including its new `ratingKey`.
   */
  async createPlaylist(params: {
    title: string;
    type: PlaylistType;
    uri: string;
  }): Promise<PlaylistsResponse> {
    return await this.post({
      endpoint: "playlists",
      params: {
        title: params.title,
        type: params.type,
        smart: "0",
        uri: params.uri,
      },
      schema: playlistsResponseSchema,
    });
  }

  /**
   * Make a GET request to the Plex Media Server
   * @param options - Request options including endpoint, params, schema
   * @returns Parsed and validated response data
   */
  private async get<T>(options: GetRequestOptions<T>): Promise<T> {
    const { endpoint, params, schema, xPlexOverrides = {} } = options;
    const maxRetries = 2;
    const errors: Error[] = [];

    for (const attempt of Array.from({ length: maxRetries + 1 }, (_, i) => i)) {
      try {
        const connection = await this.findWorkingConnection();

        // Manually construct URL to avoid encoding colons in provider identifiers
        const baseUrl = connection.uri.endsWith("/") ? connection.uri.slice(0, -1) : connection.uri;
        const endpointWithoutLeadingSlash = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;

        // Build query parameters manually
        const queryParams = new URLSearchParams();

        // Add all X-Plex parameters as query parameters, with overrides
        queryParams.append("X-Plex-Product", xPlexOverrides.product ?? this.config.product);
        queryParams.append("X-Plex-Version", xPlexOverrides.version ?? this.config.version);
        queryParams.append(
          "X-Plex-Client-Identifier",
          xPlexOverrides.clientIdentifier ?? this.config.clientIdentifier,
        );
        queryParams.append("X-Plex-Platform", xPlexOverrides.platform ?? this.config.platform);
        queryParams.append("X-Plex-Platform-Version", xPlexOverrides.platformVersion ?? "137.0");
        queryParams.append(
          "X-Plex-Features",
          xPlexOverrides.features ?? "external-media,indirect-media,hub-style-list",
        );
        queryParams.append("X-Plex-Model", xPlexOverrides.model ?? "bundled");
        queryParams.append("X-Plex-Device", xPlexOverrides.device ?? "Windows");
        queryParams.append("X-Plex-Device-Name", xPlexOverrides.deviceName ?? this.config.platform);
        queryParams.append("X-Plex-Language", xPlexOverrides.language ?? "en");
        queryParams.append("X-Plex-Token", this.token);

        // Optional parameters that can be overridden
        if (xPlexOverrides.sessionId) {
          queryParams.append("X-Plex-Session-Id", xPlexOverrides.sessionId);
        }
        if (xPlexOverrides.playbackSessionId) {
          queryParams.append("X-Plex-Playback-Session-Id", xPlexOverrides.playbackSessionId);
        }
        if (xPlexOverrides.deviceScreenResolution) {
          queryParams.append(
            "X-Plex-Device-Screen-Resolution",
            xPlexOverrides.deviceScreenResolution,
          );
        }

        if (params) {
          for (const key in params) {
            if (params.hasOwnProperty(key)) {
              queryParams.append(key, String(params[key]));
            }
          }
        }

        const headers = this.getHeaders();

        const finalUrl = `${baseUrl}/${endpointWithoutLeadingSlash}?${queryParams.toString()}`;
        const response = await fetch(finalUrl, {
          method: "GET",
          headers,
        });

        console.log(`Response from ${this.server.name}: ${response.status} ${response.statusText}`);

        if (!response.ok) {
          console.log(
            `Request to ${this.server.name} failed (attempt ${attempt + 1}): ${response.statusText}`,
          );

          const currentError = new PlexAPIError(
            `Plex Server API request failed: ${response.statusText}`,
            response.status,
            response,
          );

          throw currentError;
        }

        if (options.expectEmptyResponse) {
          return undefined as T;
        }

        const data = await response.json();

        if (schema) {
          try {
            return schema.parse(data);
          } catch (error) {
            throw new PlexAPIError(
              `Invalid response format from Plex Server API: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
          }
        }

        return data as T;
      } catch (error) {
        const currentError = error instanceof Error ? error : new Error(String(error));
        errors.push(currentError);

        console.log(
          `Request to ${this.server.name} failed (attempt ${attempt + 1}):`,
          currentError.message,
        );

        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          throw currentError;
        }

        // If this was a connection-related error, reset our cached connection
        // and try again with a different connection
        if (error instanceof PlexAPIError && error.status && error.status >= 500) {
          this.resetConnection();
          continue;
        }

        // For network errors, also try to reset and retry
        if (error instanceof TypeError && error.message.includes("fetch")) {
          this.resetConnection();
          continue;
        }

        // For other errors, don't retry
        throw currentError;
      }
    }

    throw errors[errors.length - 1] ?? new Error("Request failed after retries");
  }

  /**
   * Make a POST request to the Plex Media Server
   * @param options - Request options including endpoint, params, schema
   * @returns Parsed and validated response data
   */
  private async post<T>(options: PostRequestOptions<T>): Promise<T> {
    return this.sendWithoutBody("POST", options);
  }

  private async put<T>(options: PutRequestOptions<T>): Promise<T> {
    return this.sendWithoutBody("PUT", options);
  }

  private async sendWithoutBody<T>(
    method: "POST" | "PUT",
    options: PostRequestOptions<T> | PutRequestOptions<T>,
  ): Promise<T> {
    const { endpoint, params, schema, expectEmptyResponse = false, xPlexOverrides = {} } = options;
    const maxRetries = 2;
    const errors: Error[] = [];

    for (const attempt of Array.from({ length: maxRetries + 1 }, (_, i) => i)) {
      try {
        const connection = await this.findWorkingConnection();
        const url = new URL(endpoint, connection.uri);

        // Add all X-Plex parameters as query parameters, with overrides
        url.searchParams.append("X-Plex-Product", xPlexOverrides.product ?? this.config.product);
        url.searchParams.append("X-Plex-Version", xPlexOverrides.version ?? this.config.version);
        url.searchParams.append(
          "X-Plex-Client-Identifier",
          xPlexOverrides.clientIdentifier ?? this.config.clientIdentifier,
        );
        url.searchParams.append("X-Plex-Platform", xPlexOverrides.platform ?? this.config.platform);
        url.searchParams.append(
          "X-Plex-Platform-Version",
          xPlexOverrides.platformVersion ?? "137.0",
        );
        url.searchParams.append(
          "X-Plex-Features",
          xPlexOverrides.features ?? "external-media,indirect-media,hub-style-list",
        );
        url.searchParams.append("X-Plex-Model", xPlexOverrides.model ?? "bundled");
        url.searchParams.append("X-Plex-Device", xPlexOverrides.device ?? "Windows");
        url.searchParams.append(
          "X-Plex-Device-Name",
          xPlexOverrides.deviceName ?? this.config.platform,
        );
        url.searchParams.append("X-Plex-Language", xPlexOverrides.language ?? "en");
        url.searchParams.append("X-Plex-Token", this.token);

        // Optional parameters that can be overridden
        if (xPlexOverrides.sessionId) {
          url.searchParams.append("X-Plex-Session-Id", xPlexOverrides.sessionId);
        }
        if (xPlexOverrides.playbackSessionId) {
          url.searchParams.append("X-Plex-Playback-Session-Id", xPlexOverrides.playbackSessionId);
        }
        if (xPlexOverrides.deviceScreenResolution) {
          url.searchParams.append(
            "X-Plex-Device-Screen-Resolution",
            xPlexOverrides.deviceScreenResolution,
          );
        }

        if (params) {
          for (const key in params) {
            if (params.hasOwnProperty(key)) {
              url.searchParams.append(key, String(params[key]));
            }
          }
        }

        const headers = this.getHeaders();

        console.log(`Making ${method} request to ${this.server.name}:`);
        console.log(`Headers:`, headers);

        const response = await fetch(url.toString(), {
          method,
          headers,
        });

        console.log(`Response from ${this.server.name}: ${response.status} ${response.statusText}`);

        if (!response.ok) {
          // Log response headers for debugging
          console.log(`Response headers:`, Object.fromEntries(response.headers.entries()));

          throw new PlexAPIError(
            `Plex Server API request failed: ${response.statusText}`,
            response.status,
            response,
          );
        }

        let data: T;

        if (expectEmptyResponse) {
          // For endpoints that return empty responses, just return undefined or empty object
          data = {} as T;
        } else {
          // Try to parse JSON response
          try {
            const jsonData = await response.json();

            if (schema) {
              try {
                data = schema.parse(jsonData);
              } catch (error) {
                throw new PlexAPIError(
                  `Invalid response format from Plex Server API: ${error instanceof Error ? error.message : "Unknown error"}`,
                );
              }
            } else {
              data = jsonData as T;
            }
          } catch (jsonError) {
            // Reached only when a body was expected (the `expectEmptyResponse`
            // case returns above), so a JSON failure here is a real error.
            throw new PlexAPIError(
              `Failed to parse JSON response from Plex Server API: ${jsonError instanceof Error ? jsonError.message : "Unknown error"}`,
            );
          }
        }

        return data;
      } catch (error) {
        const currentError = error instanceof Error ? error : new Error(String(error));
        errors.push(currentError);

        console.log(
          `${method} request to ${this.server.name} failed (attempt ${attempt + 1}):`,
          currentError.message,
        );

        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          throw currentError;
        }

        // If this was a connection-related error, reset our cached connection
        // and try again with a different connection
        if (error instanceof PlexAPIError && error.status && error.status >= 500) {
          this.resetConnection();
          continue;
        }

        // For network errors, also try to reset and retry
        if (error instanceof TypeError && error.message.includes("fetch")) {
          this.resetConnection();
          continue;
        }

        // For other errors, don't retry
        throw currentError;
      }
    }

    throw errors[errors.length - 1] ?? new Error(`${method} request failed after retries`);
  }

  private getHeaders(): Record<string, string> {
    return {
      accept: "application/json",
    };
  }
}
