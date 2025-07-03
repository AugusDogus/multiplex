import {
  continueWatchingResponseSchema,
  type ContinueWatchingResponse,
} from "../schemas/continue-watching-schemas";
import {
  MediaContainerSchema,
  type MediaContainer,
} from "../schemas/plex-server-schemas";
import type { PlexDevice } from "../schemas/plex-tv-schemas";
import {
  searchResponseSchema,
  type SearchResponse,
  type SearchParams,
} from "../schemas/search-schemas";
import {
  PlexAPIError,
  type GetRequestOptions,
  type PlexConfig,
} from "../types/client-types";

/* ────────────────────────────────────────────────────────────
   Plex Server Client
   Client for interacting with individual Plex Media Server instances
   ──────────────────────────────────────────────────────────── */

/**
 * Client for interacting with individual Plex Media Server instances
 */
export class PlexServerClient {
  private readonly token: string;
  private readonly config: PlexConfig;
  private readonly server: PlexDevice;
  private workingConnection: PlexDevice["connections"][0] | null = null;
  private connectionTestPromise: Promise<PlexDevice["connections"][0]> | null =
    null;

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

  /**
   * Test a connection to see if it's working
   * @param connection - Connection to test
   * @returns Promise that resolves if connection works, rejects if not
   */
  private async testConnection(
    connection: PlexDevice["connections"][0],
  ): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 250);

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
          console.log(
            `✅ ${this.server.name}: Connected via ${result.value.connection.uri}`,
          );
          return result.value.connection;
        }
      }

      // Small delay before trying the next batch
      if (startIndex + batchSize < connections.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    console.log(`❌ ${this.server.name}: No working connections found`);
    throw new Error(
      `No working connections found for server ${this.server.name}`,
    );
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

  /**
   * Get library content by section ID
   * @param sectionId - The library section ID
   * @returns Library content
   */
  async getLibraryContent<T = unknown>(sectionId: string): Promise<T> {
    return await this.get({
      endpoint: `library/sections/${sectionId}/all`,
    });
  }

  /**
   * Get Continue Watching data for specific library directories
   * @param contentDirectoryIds - Array of library section IDs to include
   * @returns Continue Watching response with progress and metadata
   */
  async getContinueWatching(
    contentDirectoryIds: string[],
  ): Promise<ContinueWatchingResponse> {
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
              if (
                "id" in directory &&
                directory.id &&
                !isNaN(Number(directory.id))
              ) {
                libraryDirectoryIds.push(directory.id);
              }
            }
          }
        }
      }

      return await this.getContinueWatching(libraryDirectoryIds);
    } catch (error) {
      console.warn(
        `Failed to get all Continue Watching for ${this.server.name}:`,
        error,
      );
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
      limit: params.limit.toString(),
      searchTypes: params.searchTypes.join(','),
      includeCollections: params.includeCollections ? '1' : '0',
      includeExternalMedia: params.includeExternalMedia ? '1' : '0',
    };

    return await this.get({
      endpoint: '/library/search',
      params: searchParams,
      schema: searchResponseSchema,
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
        const url = new URL(endpoint, connection.uri);

        // Add all X-Plex parameters as query parameters, with overrides
        url.searchParams.append(
          "X-Plex-Product",
          xPlexOverrides.product ?? this.config.product,
        );
        url.searchParams.append(
          "X-Plex-Version",
          xPlexOverrides.version ?? this.config.version,
        );
        url.searchParams.append(
          "X-Plex-Client-Identifier",
          xPlexOverrides.clientIdentifier ?? this.config.clientIdentifier,
        );
        url.searchParams.append(
          "X-Plex-Platform",
          xPlexOverrides.platform ?? this.config.platform,
        );
        url.searchParams.append(
          "X-Plex-Platform-Version",
          xPlexOverrides.platformVersion ?? "137.0",
        );
        url.searchParams.append(
          "X-Plex-Features",
          xPlexOverrides.features ??
            "external-media,indirect-media,hub-style-list",
        );
        url.searchParams.append(
          "X-Plex-Model",
          xPlexOverrides.model ?? "bundled",
        );
        url.searchParams.append(
          "X-Plex-Device",
          xPlexOverrides.device ?? "Windows",
        );
        url.searchParams.append(
          "X-Plex-Device-Name",
          xPlexOverrides.deviceName ?? this.config.platform,
        );
        url.searchParams.append(
          "X-Plex-Language",
          xPlexOverrides.language ?? "en",
        );
        url.searchParams.append("X-Plex-Token", this.token);

        // Optional parameters that can be overridden
        if (xPlexOverrides.sessionId) {
          url.searchParams.append(
            "X-Plex-Session-Id",
            xPlexOverrides.sessionId,
          );
        }
        if (xPlexOverrides.playbackSessionId) {
          url.searchParams.append(
            "X-Plex-Playback-Session-Id",
            xPlexOverrides.playbackSessionId,
          );
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

        console.log(`Making request to ${this.server.name}:`);
        console.log(`URL: ${url.toString()}`);
        console.log(`Headers:`, headers);
        console.log(
          `Token (first 10 chars): ${this.token.substring(0, 10)}...`,
        );

        const response = await fetch(url.toString(), {
          method: "GET",
          headers,
        });

        console.log(
          `Response from ${this.server.name}: ${response.status} ${response.statusText}`,
        );

        if (!response.ok) {
          // Log response headers for debugging
          console.log(
            `Response headers:`,
            Object.fromEntries(response.headers.entries()),
          );

          throw new PlexAPIError(
            `Plex Server API request failed: ${response.statusText}`,
            response.status,
            response,
          );
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
        const currentError =
          error instanceof Error ? error : new Error(String(error));
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
        if (
          error instanceof PlexAPIError &&
          error.status &&
          error.status >= 500
        ) {
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

    throw (
      errors[errors.length - 1] ?? new Error("Request failed after retries")
    );
  }

  private getHeaders(): Record<string, string> {
    return {
      accept: "application/json",
    };
  }
}
