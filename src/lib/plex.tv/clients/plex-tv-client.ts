import {
  rawUserInfoSchema,
  sessionsSchema,
  userInfoSchema,
  type PlexDevice,
  type PlexUserInfo,
} from "../schemas/plex-tv-schemas";
import {
  PlexAPIError,
  type GetRequestOptions,
  type PlexConfig,
} from "../types/client-types";
import { PlexServerClient } from "./plex-server-client";

/* ────────────────────────────────────────────────────────────
   Plex.tv Client
   Client for interacting with the Plex.tv API
   ──────────────────────────────────────────────────────────── */

/**
 * Client for interacting with the Plex.tv API
 */
export class PlexTvClient {
  private readonly token: string;
  private readonly config: PlexConfig;
  private readonly baseUrl = "https://plex.tv/api/v2/";

  /**
   * @param token - Plex authentication token
   * @param config - Client configuration
   */
  constructor(token: string, config: PlexConfig) {
    this.token = token;
    this.config = config;
  }

  /**
   * Get list of available Plex Media Servers
   * @returns Array of Plex Media Server devices
   */
  async getServers(): Promise<PlexDevice[]> {
    const data = await this.get({
      endpoint: "resources",
      params: {
        includeHttps: 1,
        includeRelay: 1,
        includeIPv6: 1,
      },
      schema: sessionsSchema,
    });

    const servers = data.filter(
      (device) => device.product === "Plex Media Server",
    );

    return servers;
  }

  /**
   * Get user information
   * @returns User information including subscriptions, providers, and settings
   */
  async getUserInfo(): Promise<PlexUserInfo> {
    const rawData = await this.get({
      endpoint: "user",
      params: {
        includeSubscriptions: 1,
        includeProviders: 1,
        includeSettings: 1,
        includeSharedSettings: 1,
      },
      schema: rawUserInfoSchema,
      baseUrl: "https://clients.plex.tv/api/v2/",
      xPlexOverrides: {
        product: "Plex Web",
      },
    });

    // Transform the raw data to get parsed settings
    return userInfoSchema.parse(rawData);
  }

  /**
   * Get the authentication token
   * @returns The Plex authentication token
   */
  getToken(): string {
    return this.token;
  }

  /**
   * Create a server client for a specific Plex Media Server
   * @param server - The server device to create a client for
   * @returns PlexServerClient instance
   */
  createServerClient(server: PlexDevice): PlexServerClient {
    return new PlexServerClient(server, this.token, this.config);
  }

  /**
   * Get all resources (servers, players, etc.)
   * @todo Implement resource retrieval
   */
  async getResources() {
    throw new Error("Not implemented yet");
  }

  /**
   * Get user's friends
   * @todo Implement friends retrieval
   */
  async getFriends() {
    throw new Error("Not implemented yet");
  }

  /**
   * Make a GET request to the Plex.tv API
   * @param options - Request options including endpoint, params, schema, and baseUrl
   * @returns Parsed and validated response data
   */
  private async get<T>(options: GetRequestOptions<T>): Promise<T> {
    const { endpoint, params, schema, baseUrl, xPlexOverrides = {} } = options;
    const url = new URL(endpoint, baseUrl ?? this.baseUrl);

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
      xPlexOverrides.features ?? "external-media,indirect-media,hub-style-list",
    );
    url.searchParams.append(
      "X-Plex-Model",
      xPlexOverrides.model ?? "standalone",
    );
    url.searchParams.append(
      "X-Plex-Device",
      xPlexOverrides.device ?? "Windows",
    );
    url.searchParams.append(
      "X-Plex-Device-Name",
      xPlexOverrides.deviceName ?? this.config.platform,
    );
    url.searchParams.append("X-Plex-Language", xPlexOverrides.language ?? "en");
    url.searchParams.append("X-Plex-Token", this.token);

    if (params) {
      for (const key in params) {
        if (params.hasOwnProperty(key)) {
          url.searchParams.append(key, String(params[key]));
        }
      }
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      // Add more specific error handling for common cases
      if (response.status === 401) {
        throw new PlexAPIError(
          `Plex authentication failed. Your token may have expired or been revoked. Please sign in again.`,
          response.status,
          response,
        );
      }

      throw new PlexAPIError(
        `Plex API request failed: ${response.statusText}`,
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
          `Invalid response format from Plex API: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    return data as T;
  }

  /**
   * Make a POST request to the Plex.tv API
   * @returns Parsed and validated response data
   * @todo Implement POST functionality
   */
  private async post<T>(): Promise<T> {
    throw new Error("POST method not implemented yet");
  }

  private getHeaders(): Record<string, string> {
    return {
      accept: "application/json",
    };
  }
}
