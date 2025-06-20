import { type z } from "zod";
import { sessionsSchema, type PlexDevice } from "./schemas";

export interface PlexConfig {
  product: string;
  clientIdentifier: string;
  version: string;
  platform: string;
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
    const data = await this.get("resources", {}, sessionsSchema);

    const servers = data.filter(
      (device) => device.product === "Plex Media Server",
    );

    return servers;
  }

  /**
   * Get user information
   * @todo Implement user info retrieval
   */
  async getUserInfo() {
    throw new Error("Not implemented yet");
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
   * @param endpoint - API endpoint path
   * @param params - Optional query parameters
   * @param schema - Optional Zod schema for response validation
   * @returns Parsed and validated response data
   */
  private async get<T>(
    endpoint: string,
    params?: Record<string, string | number | boolean>,
    schema?: z.ZodType<T>,
  ): Promise<T> {
    const url = new URL(endpoint, this.baseUrl);

    url.searchParams.append(
      "X-Plex-Client-Identifier",
      this.config.clientIdentifier,
    );
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
