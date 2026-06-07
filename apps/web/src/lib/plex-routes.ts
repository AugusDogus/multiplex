const METADATA_KEY_PATTERN = /^\/library\/metadata\/(\d+)$/;

export function getItemDetailsHref(
  machineIdentifier: string,
  ratingKey: string,
): string {
  // Plex encodes key (%2F…), but we keep slashes literal for readability.
  // Safe here: we own the shape and ratingKey is numeric; Next decodes on read.
  return `/server/${machineIdentifier}/details?key=/library/metadata/${ratingKey}`;
}

export function parseItemDetailsKey(key: string | undefined): string | null {
  if (!key) {
    return null;
  }

  const match = METADATA_KEY_PATTERN.exec(key);
  return match?.[1] ?? null;
}
