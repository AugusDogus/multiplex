import { PlexAPIError, type GetRequestOptions, type PlexConfig } from "../types/client-types";

export class PlexTvBaseClient {
  private readonly baseUrl = "https://plex.tv/api/v2/";

  constructor(protected readonly config: PlexConfig) {}

  protected async get<T>(token: string, options: GetRequestOptions<T>): Promise<T> {
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
