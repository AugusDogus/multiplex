import {
  rawUserInfoSchema,
  sessionsSchema,
  userInfoSchema,
  type PlexDevice,
  type PlexUserInfo,
} from "../schemas/plex-tv-schemas";
import type { PlexConfig } from "../types/client-types";
import { PlexTvBaseClient } from "./plex-tv-base-client";

/**
 * Stateless Plex.tv helper for auth flows.
 * The service owns app configuration and accepts a Plex token per request.
 */
export class PlexTvAuthService extends PlexTvBaseClient {
  constructor(config: PlexConfig) {
    super(config);
  }

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
}
