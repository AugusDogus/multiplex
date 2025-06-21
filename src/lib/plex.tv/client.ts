import { type z } from "zod";
import {
  rawUserInfoSchema,
  sessionsSchema,
  userInfoSchema,
  type PlexDevice,
  type PlexUserInfo,
} from "./schemas";

export interface PlexConfig {
  product: string;
  clientIdentifier: string;
  version: string;
  platform: string;
}

interface GetRequestOptions<T> {
  endpoint: string;
  params?: Record<string, string | number | boolean>;
  schema?: z.ZodType<T>;
  baseUrl?: string;
  xPlexOverrides?: Partial<{
    product: string;
    version: string;
    clientIdentifier: string;
    platform: string;
    platformVersion: string;
    features: string;
    model: string;
    device: string;
    deviceName: string;
    language: string;
  }>;
}

export class PlexAPIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public response?: Response,
  ) {
    super(message);
    this.name = "PlexAPIError";
  }
}

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
      params: {},
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
   * @param endpoint - API endpoint path
   * @param body - Optional request body
   * @param schema - Optional Zod schema for response validation
   * @returns Parsed and validated response data
   * @todo Implement POST functionality
   */
  private async post<T>(
    endpoint: string,
    body?: Record<string, unknown>,
    schema?: z.ZodType<T>,
  ): Promise<T> {
    throw new Error("POST method not implemented yet");
  }

  private getHeaders(): Record<string, string> {
    return {
      accept: "application/json",
    };
  }
}
