export interface ParsedHubKey {
  endpoint: string;
  params: Record<string, string>;
}

const ALLOWED_HUB_ENDPOINT_PREFIXES = ["hubs/", "library/sections/", "playlists/"] as const;

export function parseHubKey(hubKey: string): ParsedHubKey {
  const trimmed = hubKey.startsWith("/") ? hubKey.slice(1) : hubKey;
  const questionIndex = trimmed.indexOf("?");
  const path = questionIndex === -1 ? trimmed : trimmed.slice(0, questionIndex);
  const query = questionIndex === -1 ? "" : trimmed.slice(questionIndex + 1);
  const params = Object.fromEntries(new URLSearchParams(query));

  return {
    endpoint: path,
    params,
  };
}

export function isAllowedHubEndpoint(endpoint: string): boolean {
  return ALLOWED_HUB_ENDPOINT_PREFIXES.some((prefix) => endpoint.startsWith(prefix));
}

export function assertAllowedHubKey(hubKey: string): ParsedHubKey {
  const parsed = parseHubKey(hubKey);

  if (!parsed.endpoint || !isAllowedHubEndpoint(parsed.endpoint)) {
    throw new Error(`Hub key is not allowed: ${hubKey}`);
  }

  return parsed;
}
