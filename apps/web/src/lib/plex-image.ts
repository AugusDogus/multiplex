export const MAX_PLEX_IMAGE_DIMENSION = 2_000;

export interface PlexImageOptions {
  width: number;
  height: number;
  minSize?: boolean;
  upscale?: boolean;
}

export interface PlexImageRequest {
  serverId: string;
  path: string;
  width: number;
  height: number;
  minSize: boolean;
  upscale: boolean;
}

export type PlexImageRequestParseResult =
  | { ok: true; value: PlexImageRequest }
  | { ok: false; reason: string };

const SERVER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const ARTWORK_PATH_PATTERNS = [
  /^\/library\/metadata\/\d+\/(?:thumb|art|banner)\/\d+$/,
  /^\/library\/(?:collections|playlists)\/\d+\/(?:composite|thumb)\/\d+$/,
  /^\/playlists\/\d+\/composite\/\d+$/,
  /^\/:\/resources\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+\.(?:avif|gif|jpe?g|png|webp)$/i,
] as const;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const RAW_PATH_QUERY_KEYS = new Set(["height", "width"]);
const REQUEST_QUERY_KEYS = new Set([
  "serverId",
  "path",
  "width",
  "height",
  "minSize",
  "upscale",
]);

function isBoundedDimension(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_PLEX_IMAGE_DIMENSION
  );
}

function hasOnlySingletonKeys(
  params: URLSearchParams,
  allowedKeys: ReadonlySet<string>,
): boolean {
  for (const key of params.keys()) {
    if (!allowedKeys.has(key) || params.getAll(key).length !== 1) {
      return false;
    }
  }

  return true;
}

function parseDimension(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  const dimension = Number(value);
  return isBoundedDimension(dimension) ? dimension : null;
}

function parseBooleanOption(value: string | null): boolean | null {
  if (value === "1") return true;
  if (value === "0") return false;
  return null;
}

export function isAllowedPlexImagePath(rawPath: string): boolean {
  if (
    rawPath.length === 0 ||
    rawPath.length > 1_024 ||
    CONTROL_CHARACTER_PATTERN.test(rawPath) ||
    rawPath.includes("\\") ||
    rawPath.includes("#") ||
    rawPath.startsWith("//") ||
    /^[A-Za-z][A-Za-z\d+.-]*:/.test(rawPath)
  ) {
    return false;
  }

  const queryIndex = rawPath.indexOf("?");
  const pathname = queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : rawPath.slice(queryIndex + 1);

  if (
    !ARTWORK_PATH_PATTERNS.some((pattern) => pattern.test(pathname)) ||
    pathname.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return false;
  }

  if (!query) {
    return queryIndex === -1;
  }

  const params = new URLSearchParams(query);
  if (!hasOnlySingletonKeys(params, RAW_PATH_QUERY_KEYS)) {
    return false;
  }

  return [...params.values()].every((value) => parseDimension(value) !== null);
}

export function getPlexImagePath(
  serverId: string | undefined,
  rawPath: string | undefined,
  options: PlexImageOptions,
): string | undefined {
  if (
    !serverId ||
    !SERVER_ID_PATTERN.test(serverId) ||
    !rawPath ||
    !isAllowedPlexImagePath(rawPath) ||
    !isBoundedDimension(options.width) ||
    !isBoundedDimension(options.height)
  ) {
    return undefined;
  }

  const params = new URLSearchParams({
    serverId,
    path: rawPath,
    width: options.width.toString(),
    height: options.height.toString(),
    minSize: (options.minSize ?? true) ? "1" : "0",
    upscale: (options.upscale ?? true) ? "1" : "0",
  });

  return `/api/plex/image?${params.toString()}`;
}

export function parsePlexImageRequest(url: URL): PlexImageRequestParseResult {
  const params = url.searchParams;
  if (!hasOnlySingletonKeys(params, REQUEST_QUERY_KEYS)) {
    return { ok: false, reason: "Unexpected or repeated query parameter" };
  }

  const serverId = params.get("serverId");
  const path = params.get("path");
  const width = parseDimension(params.get("width"));
  const height = parseDimension(params.get("height"));
  const minSize = parseBooleanOption(params.get("minSize"));
  const upscale = parseBooleanOption(params.get("upscale"));

  if (!serverId || !SERVER_ID_PATTERN.test(serverId)) {
    return { ok: false, reason: "Invalid server ID" };
  }

  if (!path || !isAllowedPlexImagePath(path)) {
    return { ok: false, reason: "Invalid artwork path" };
  }

  if (width === null || height === null) {
    return { ok: false, reason: "Invalid image dimensions" };
  }

  if (minSize === null || upscale === null) {
    return { ok: false, reason: "Invalid image options" };
  }

  return {
    ok: true,
    value: { serverId, path, width, height, minSize, upscale },
  };
}
