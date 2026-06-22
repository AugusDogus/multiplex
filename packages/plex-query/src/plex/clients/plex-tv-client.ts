import {
  rawUserInfoSchema,
  sessionsSchema,
  userInfoSchema,
  type PlexDevice,
  type PinnedSource,
  type PlexUserInfo,
} from "../schemas/plex-tv-schemas";
import type { PlexConfig } from "../types/client-types";
import {
  PLEX_CLIENTS_API_BASE_URL,
  PLEX_CLIENTS_USER_API_BASE_URL,
  PlexTvBaseClient,
} from "./plex-tv-base-client";
import { PlexServerClient } from "./plex-server-client";

/* ────────────────────────────────────────────────────────────
   Plex.tv Client
   Client for interacting with the Plex.tv API
   ──────────────────────────────────────────────────────────── */

/**
 * Client for interacting with the Plex.tv API
 */
export class PlexTvClient extends PlexTvBaseClient {
  private readonly token: string;

  private buildExperienceSettingValue(
    settings: PlexUserInfo["settings"] | undefined,
    pinnedSources: PinnedSource[],
  ): string {
    const experienceSettings: Partial<NonNullable<PlexUserInfo["settings"]>> = settings
      ? { ...settings }
      : {};

    delete experienceSettings.otherSettings;

    return JSON.stringify({
      ...experienceSettings,
      sidebarSettings: {
        ...experienceSettings.sidebarSettings,
        hasCompletedSetup: experienceSettings.sidebarSettings?.hasCompletedSetup ?? true,
        pinnedSources,
      },
    });
  }

  /**
   * @param token - Plex authentication token
   * @param config - Client configuration
   */
  constructor(token: string, config: PlexConfig) {
    super(config);
    this.token = token;
  }

  /**
   * Get list of available Plex Media Servers
   * @returns Array of Plex Media Server devices
   */
  async getServers(): Promise<PlexDevice[]> {
    const data = await this.get(this.token, {
      endpoint: "resources",
      params: {
        includeHttps: 1,
        includeRelay: 1,
        includeIPv6: 1,
      },
      schema: sessionsSchema,
    });

    const servers = data.filter((device) => device.product === "Plex Media Server");

    return servers;
  }

  /**
   * Get user information
   * @returns User information including subscriptions, providers, and settings
   */
  async getUserInfo(): Promise<PlexUserInfo> {
    const rawData = await this.get(this.token, {
      endpoint: "user",
      params: {
        includeSubscriptions: 1,
        includeProviders: 1,
        includeSettings: 1,
        includeSharedSettings: 1,
      },
      schema: rawUserInfoSchema,
      baseUrl: PLEX_CLIENTS_API_BASE_URL,
      xPlexOverrides: {
        product: "Plex Web",
      },
    });

    // Transform the raw data to get parsed settings
    return userInfoSchema.parse(rawData);
  }

  async updateSidebarPinnedSources(pinnedSources: PinnedSource[]): Promise<void> {
    const userInfo = await this.getUserInfo();
    const experienceValue = this.buildExperienceSettingValue(userInfo.settings, pinnedSources);
    const body = JSON.stringify({
      value: JSON.stringify([
        {
          id: "experience",
          type: "json",
          value: experienceValue,
          hidden: true,
        },
      ]),
    });

    await this.post(this.token, {
      endpoint: "settings",
      params: {
        sharedSettings: 1,
      },
      baseUrl: PLEX_CLIENTS_USER_API_BASE_URL,
      contentType: "application/json",
      body,
      xPlexOverrides: {
        product: "Plex Web",
        sessionId: crypto.randomUUID(),
      },
    });
  }

  async syncViewState(): Promise<void> {
    await this.put(this.token, {
      endpoint: "user/view_state_sync",
      params: {
        context: "tail=false",
        consent: true,
      },
      baseUrl: PLEX_CLIENTS_API_BASE_URL,
      expectEmptyResponse: true,
      xPlexOverrides: {
        product: "Plex Web",
        sessionId: crypto.randomUUID(),
      },
    });
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
}
