import {
  rawUserInfoSchema,
  sessionsSchema,
  userInfoSchema,
  type PlexDevice,
  type PlexUserInfo,
} from "../schemas/plex-tv-schemas";
import { PlexAPIError, type GetRequestOptions, type PlexConfig } from "../types/client-types";

/**
 * Stateless Plex.tv helper for auth flows.
 * The service owns app configuration and accepts a Plex token per request.
 */
export class PlexTvAuthService {
  private readonly baseUrl = "https://plex.tv/api/v2/";

  constructor(private readonly config: PlexConfig) {}

  async getServers(token: string): Promise<PlexDevice[]> {
    const data = await this.get(token, {
      endpoint: "resources",
      params: {
        includeHttps: 1,
        includeRelay: 1,
        includeIPv6: 1,
      },
      schema: sessionsSchema,
    });

    return data.filter((device) => device.product === "Plex Media Server");
  }

  async getUserInfo(token: string): Promise<PlexUserInfo> {
    const rawData = await this.get(token, {
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

    return userInfoSchema.parse(rawData);
  }

  private async get<T>(token: string, options: GetRequestOptions<T>): Promise<T> {
    const { endpoint, params, schema, baseUrl, xPlexOverrides = {} } = options;
    const url = new URL(endpoint, baseUrl ?? this.baseUrl);

    url.searchParams.append("X-Plex-Product", xPlexOverrides.product ?? this.config.product);
    url.searchParams.append("X-Plex-Version", xPlexOverrides.version ?? this.config.version);
    url.searchParams.append(
      "X-Plex-Client-Identifier",
      xPlexOverrides.clientIdentifier ?? this.config.clientIdentifier,
    );
    url.searchParams.append("X-Plex-Platform", xPlexOverrides.platform ?? this.config.platform);
    url.searchParams.append("X-Plex-Platform-Version", xPlexOverrides.platformVersion ?? "137.0");
    url.searchParams.append(
      "X-Plex-Features",
      xPlexOverrides.features ?? "external-media,indirect-media,hub-style-list",
    );
    url.searchParams.append("X-Plex-Model", xPlexOverrides.model ?? "standalone");
    url.searchParams.append("X-Plex-Device", xPlexOverrides.device ?? "Windows");
    url.searchParams.append(
      "X-Plex-Device-Name",
      xPlexOverrides.deviceName ?? this.config.platform,
    );
    url.searchParams.append("X-Plex-Language", xPlexOverrides.language ?? "en");
    url.searchParams.append("X-Plex-Token", token);

    if (params) {
      for (const key in params) {
        if (params.hasOwnProperty(key)) {
          url.searchParams.append(key, String(params[key]));
        }
      }
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new PlexAPIError(
          "Plex authentication failed. Your token may have expired or been revoked. Please sign in again.",
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
}
