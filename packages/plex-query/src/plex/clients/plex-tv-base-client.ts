import {
  PlexAPIError,
  type GetRequestOptions,
  type PlexConfig,
  type PostRequestOptions,
  type PutRequestOptions,
} from "../types/client-types";

export const PLEX_TV_API_BASE_URL = "https://plex.tv/api/v2/";
export const PLEX_CLIENTS_BASE_URL = "https://clients.plex.tv/";
export const PLEX_CLIENTS_API_BASE_URL = "https://clients.plex.tv/api/v2/";
export const PLEX_CLIENTS_USER_API_BASE_URL = `${PLEX_CLIENTS_API_BASE_URL}user/`;

export class PlexTvBaseClient {
  private readonly baseUrl = PLEX_TV_API_BASE_URL;

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

  private buildUrl<T>(token: string, options: GetRequestOptions<T> | PostRequestOptions<T>): URL {
    const { endpoint, params, baseUrl, xPlexOverrides = {} } = options;
    const url = new URL(endpoint, baseUrl ?? this.baseUrl);

    this.appendXPlexParams(url, token, xPlexOverrides);

    if (params) {
      for (const key in params) {
        if (params.hasOwnProperty(key)) {
          url.searchParams.append(key, String(params[key]));
        }
      }
    }

    return url;
  }

  private async parseResponse<T>(
    response: Response,
    schema: GetRequestOptions<T>["schema"] | PostRequestOptions<T>["schema"],
    expectEmptyResponse = false,
  ): Promise<T> {
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

    const data = await response.json().catch((error: unknown) => {
      if (expectEmptyResponse) {
        return undefined as T;
      }

      throw new PlexAPIError(
        `Invalid JSON from Plex API: ${error instanceof Error ? error.message : "Unknown error"}`,
        response.status,
        response,
      );
    });

    if (data === undefined) {
      return undefined as T;
    }

    if (!schema) {
      return data as T;
    }

    try {
      return schema.parse(data);
    } catch (error) {
      throw new PlexAPIError(
        `Invalid response format from Plex API: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  protected async get<T>(token: string, options: GetRequestOptions<T>): Promise<T> {
    const url = this.buildUrl(token, options);
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        accept: "application/json",
      },
    });

    return this.parseResponse(response, options.schema, options.expectEmptyResponse ?? false);
  }

  protected async post<T>(token: string, options: PostRequestOptions<T>): Promise<T> {
    return this.sendWithBody(token, "POST", options);
  }

  protected async put<T>(token: string, options: PutRequestOptions<T>): Promise<T> {
    return this.sendWithBody(token, "PUT", options);
  }

  private async sendWithBody<T>(
    token: string,
    method: "POST" | "PUT",
    options: PostRequestOptions<T> | PutRequestOptions<T>,
  ): Promise<T> {
    const url = this.buildUrl(token, options);
    const headers: HeadersInit = {
      accept: "application/json",
    };

    if (options.contentType) {
      headers["content-type"] = options.contentType;
    }

    const response = await fetch(url.toString(), {
      method,
      headers,
      body: options.body,
    });

    return this.parseResponse(response, options.schema, options.expectEmptyResponse ?? false);
  }
}
