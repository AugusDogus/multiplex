import {
  PlexAPIError,
  type GetRequestOptions,
  type PlexConfig,
  type PostRequestOptions,
} from "../types/client-types";

export class PlexTvBaseClient {
  private readonly baseUrl = "https://plex.tv/api/v2/";

  constructor(protected readonly config: PlexConfig) {}

  private appendXPlexParams(
    url: URL,
    token: string,
    xPlexOverrides: NonNullable<GetRequestOptions<unknown>["xPlexOverrides"]> = {},
  ): void {
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
  }

  private async request<T>(
    method: "GET" | "POST",
    token: string,
    options: GetRequestOptions<T> | PostRequestOptions<T>,
  ): Promise<T> {
    const { endpoint, params, schema, baseUrl, xPlexOverrides = {} } = options;
    const url = new URL(endpoint, baseUrl ?? this.baseUrl);

    this.appendXPlexParams(url, token, xPlexOverrides);

    if (params) {
      for (const key in params) {
        if (params.hasOwnProperty(key)) {
          url.searchParams.append(key, String(params[key]));
        }
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        accept: "application/json",
        ...("contentType" in options && options.contentType
          ? {
              "content-type": options.contentType,
            }
          : {}),
      },
      ...("body" in options && options.body ? { body: options.body } : {}),
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

    if ("expectEmptyResponse" in options && options.expectEmptyResponse) {
      return undefined as T;
    }

    const responseText = await response.text();

    if (!responseText) {
      return undefined as T;
    }

    const contentType = response.headers.get("content-type") ?? "";

    let data: unknown;
    if (contentType.includes("application/json")) {
      try {
        data = JSON.parse(responseText);
      } catch (error) {
        throw new PlexAPIError(
          `Invalid JSON from Plex API: ${error instanceof Error ? error.message : "Unknown error"}`,
          response.status,
          response,
        );
      }
    } else {
      data = responseText;
    }

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

  protected async get<T>(token: string, options: GetRequestOptions<T>): Promise<T> {
    return this.request("GET", token, options);
  }

  protected async post<T>(token: string, options: PostRequestOptions<T>): Promise<T> {
    return this.request("POST", token, options);
  }
}
