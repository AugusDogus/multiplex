const METADATA_KEY_PATTERN = /^\/library\/metadata\/(\d+)$/;

export function getItemDetailsHref(
  machineIdentifier: string,
  ratingKey: string,
): string {
  const params = new URLSearchParams({
    key: `/library/metadata/${ratingKey}`,
  });
  return `/server/${machineIdentifier}/details?${params}`;
}

export function parseItemDetailsKey(key: string | undefined): string | null {
  if (!key) {
    return null;
  }

  const match = METADATA_KEY_PATTERN.exec(key);
  return match?.[1] ?? null;
}
