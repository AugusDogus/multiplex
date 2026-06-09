export interface ParsedHubKey {
  endpoint: string;
  params: Record<string, string>;
}

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

export function supportsHubPagination(endpoint: string): boolean {
  return (
    endpoint.startsWith("library/sections/") ||
    endpoint.startsWith("hubs/") ||
    endpoint.startsWith("playlists/")
  );
}
