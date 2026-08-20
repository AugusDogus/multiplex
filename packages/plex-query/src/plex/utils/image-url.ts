export const MAX_PLEX_IMAGE_DIMENSION = 2_000;

export interface PlexImageOptions {
  width: number;
  height: number;
  minSize?: boolean;
  upscale?: boolean;
  serverUrl?: string | null;
  authToken?: string | null;
}

const ARTWORK_PATH_PATTERNS = [
  /^\/library\/metadata\/\d+\/(?:thumb|art|banner)\/\d+$/,
  /^\/library\/(?:collections|playlists)\/\d+\/(?:composite|thumb)\/\d+$/,
  /^\/playlists\/\d+\/composite\/\d+$/,
  /^\/:\/resources\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+\.(?:avif|gif|jpe?g|png|webp)$/i,
] as const;
const RAW_PATH_QUERY_KEYS = new Set(["height", "width"]);

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function isBoundedDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_PLEX_IMAGE_DIMENSION;
}

function hasOnlySingletonKeys(params: URLSearchParams, allowedKeys: ReadonlySet<string>): boolean {
  for (const key of params.keys()) {
    if (!allowedKeys.has(key) || params.getAll(key).length !== 1) {
      return false;
    }
  }
  return true;
}

function parseDimension(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const dimension = Number(value);
  return isBoundedDimension(dimension) ? dimension : null;
}

function getPublicHttpsImageUrl(rawPath: string): string | null {
  try {
    const url = new URL(rawPath);
    if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isValidServerUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

export function isAllowedPlexImagePath(rawPath: string): boolean {
  if (
    rawPath.length === 0 ||
    rawPath.length > 1_024 ||
    hasControlCharacter(rawPath) ||
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
  if (!query) return queryIndex === -1;

  const params = new URLSearchParams(query);
  return (
    hasOnlySingletonKeys(params, RAW_PATH_QUERY_KEYS) &&
    [...params.values()].every((value) => parseDimension(value) !== null)
  );
}

export function getPlexImagePath(
  rawPath: string | undefined,
  options: PlexImageOptions,
): string | undefined {
  if (!rawPath || !isBoundedDimension(options.width) || !isBoundedDimension(options.height)) {
    return undefined;
  }

  const publicImageUrl = getPublicHttpsImageUrl(rawPath);
  if (publicImageUrl) return publicImageUrl;

  const serverUrl = options.serverUrl?.trim();
  const authToken = options.authToken?.trim();
  if (
    !serverUrl ||
    !authToken ||
    !isValidServerUrl(serverUrl) ||
    !isAllowedPlexImagePath(rawPath)
  ) {
    return undefined;
  }

  const upstream = new URL("photo/:/transcode", `${serverUrl.replace(/\/$/, "")}/`);
  const separator = rawPath.includes("?") ? "&" : "?";
  upstream.searchParams.set("width", options.width.toString());
  upstream.searchParams.set("height", options.height.toString());
  upstream.searchParams.set(
    "url",
    `${rawPath}${separator}X-Plex-Token=${encodeURIComponent(authToken)}`,
  );
  upstream.searchParams.set("X-Plex-Token", authToken);
  upstream.searchParams.set("minSize", (options.minSize ?? true) ? "1" : "0");
  upstream.searchParams.set("upscale", (options.upscale ?? true) ? "1" : "0");
  return upstream.toString();
}
