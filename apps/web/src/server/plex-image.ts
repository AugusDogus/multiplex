import type { PlexImageRequest } from "~/lib/plex-image";
import { parsePlexImageRequest } from "~/lib/plex-image";

export const MAX_PLEX_IMAGE_BYTES = 10 * 1024 * 1024;
export const PLEX_IMAGE_TIMEOUT_MS = 10_000;

const ALLOWED_PLEX_IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

interface PlexImageConnection {
  uri: string;
  local: boolean;
  relay: boolean;
}

export interface PlexImageServer {
  clientIdentifier: string;
  accessToken: string | null;
  presence: boolean;
  connections: PlexImageConnection[];
}

export interface PlexImageAuthContext {
  token: string;
  servers: PlexImageServer[];
}

export interface PlexImageRouteDependencies {
  authenticate: (request: Request) => Promise<PlexImageAuthContext | null>;
  fetch: (input: URL, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

function errorResponse(status: number, message: string): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function connectionUrl(connection: PlexImageConnection): URL | null {
  try {
    const url = new URL(connection.uri);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function rankedConnections(server: PlexImageServer): URL[] {
  const validConnections = server.connections
    .map((connection) => ({ connection, url: connectionUrl(connection) }))
    .filter(
      (entry): entry is { connection: PlexImageConnection; url: URL } =>
        entry.url !== null,
    );

  validConnections.sort((left, right) => {
    const score = (entry: (typeof validConnections)[number]) => {
      if (entry.url.protocol === "https:" && !entry.connection.local) return 0;
      if (entry.url.protocol === "https:") return 1;
      if (entry.connection.relay) return 2;
      return 3;
    };

    return score(left) - score(right);
  });

  return validConnections.map(({ url }) => url);
}

async function discardResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // A failed discard must not prevent trying another authorized connection.
  }
}

export function buildPlexTranscodeUrl(
  connection: URL,
  token: string,
  request: PlexImageRequest,
): URL {
  const upstream = new URL(
    "photo/:/transcode",
    `${connection.toString().replace(/\/$/, "")}/`,
  );
  const separator = request.path.includes("?") ? "&" : "?";
  upstream.searchParams.set("width", request.width.toString());
  upstream.searchParams.set("height", request.height.toString());
  upstream.searchParams.set(
    "url",
    `${request.path}${separator}X-Plex-Token=${encodeURIComponent(token)}`,
  );
  upstream.searchParams.set("X-Plex-Token", token);
  upstream.searchParams.set("minSize", request.minSize ? "1" : "0");
  upstream.searchParams.set("upscale", request.upscale ? "1" : "0");
  return upstream;
}

function parseContentLength(value: string | null): number | null | "invalid" {
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return "invalid";
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : "invalid";
}

function boundedBody(
  body: ReadableStream<Uint8Array>,
  abortController: AbortController,
  clearDeadline: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let received = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          clearDeadline();
          controller.close();
          return;
        }

        received += result.value.byteLength;
        if (received > MAX_PLEX_IMAGE_BYTES) {
          abortController.abort();
          await reader.cancel("Plex image exceeded the byte limit");
          clearDeadline();
          controller.error(new Error("Plex image exceeded the byte limit"));
          return;
        }

        controller.enqueue(result.value);
      } catch (cause) {
        clearDeadline();
        controller.error(cause);
      }
    },
    async cancel(reason) {
      abortController.abort();
      clearDeadline();
      await reader.cancel(reason);
    },
  });
}

export async function handlePlexImageRequest(
  request: Request,
  dependencies: PlexImageRouteDependencies,
): Promise<Response> {
  let authContext: PlexImageAuthContext | null;
  try {
    authContext = await dependencies.authenticate(request);
  } catch {
    return errorResponse(503, "Unable to verify Plex access");
  }

  if (!authContext) {
    return errorResponse(401, "Authentication required");
  }

  const parsed = parsePlexImageRequest(new URL(request.url));
  if (!parsed.ok) {
    return errorResponse(400, parsed.reason);
  }

  const server = authContext.servers.find(
    (candidate) => candidate.clientIdentifier === parsed.value.serverId,
  );
  if (!server) {
    return errorResponse(404, "Plex server not found");
  }

  if (!server.presence) {
    return errorResponse(503, "Plex server is unavailable");
  }

  const connections = rankedConnections(server);
  if (connections.length === 0) {
    return errorResponse(502, "Plex server has no usable connection");
  }

  const token = server.accessToken ?? authContext.token;
  const abortController = new AbortController();
  const deadline = setTimeout(
    () => abortController.abort(),
    dependencies.timeoutMs ?? PLEX_IMAGE_TIMEOUT_MS,
  );
  let deadlineCleared = false;
  const clearDeadline = () => {
    if (!deadlineCleared) {
      clearTimeout(deadline);
      deadlineCleared = true;
    }
  };

  let lastFailure = "Plex image request failed";

  for (const connection of connections) {
    if (abortController.signal.aborted) {
      clearDeadline();
      return errorResponse(504, "Plex image request timed out");
    }

    const upstreamUrl = buildPlexTranscodeUrl(connection, token, parsed.value);
    let upstream: Response;
    try {
      upstream = await dependencies.fetch(upstreamUrl, {
        method: "GET",
        headers: { Accept: "image/*" },
        redirect: "manual",
        signal: abortController.signal,
      });
    } catch {
      if (abortController.signal.aborted) {
        clearDeadline();
        return errorResponse(504, "Plex image request timed out");
      }
      lastFailure = "Plex image request failed";
      continue;
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      await discardResponse(upstream);
      lastFailure = "Plex image redirects are not allowed";
      continue;
    }

    if (!upstream.ok) {
      await discardResponse(upstream);
      lastFailure = "Plex image request was unsuccessful";
      continue;
    }

    const contentType = upstream.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim();
    if (
      !contentType ||
      !ALLOWED_PLEX_IMAGE_CONTENT_TYPES.has(contentType.toLowerCase())
    ) {
      await discardResponse(upstream);
      lastFailure = "Plex returned an unsupported image response";
      continue;
    }

    const contentLength = parseContentLength(
      upstream.headers.get("content-length"),
    );
    if (
      contentLength === "invalid" ||
      (contentLength !== null && contentLength > MAX_PLEX_IMAGE_BYTES)
    ) {
      await discardResponse(upstream);
      lastFailure = "Plex image exceeds the byte limit";
      continue;
    }

    if (!upstream.body) {
      lastFailure = "Plex returned an empty image response";
      continue;
    }

    const headers = new Headers({
      "Cache-Control": "private, max-age=3600",
      "Content-Type": contentType,
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    });
    if (contentLength !== null) {
      headers.set("Content-Length", contentLength.toString());
    }

    return new Response(
      boundedBody(upstream.body, abortController, clearDeadline),
      { status: 200, headers },
    );
  }

  clearDeadline();
  return errorResponse(502, lastFailure);
}
