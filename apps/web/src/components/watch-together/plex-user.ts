export interface PlexUserLike {
  id?: number;
  title?: string | null;
  username?: string | null;
  thumb?: string | null;
}

function nonEmptyLabel(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getPlexUserName(user: PlexUserLike): string {
  return (
    nonEmptyLabel(user.title) ?? nonEmptyLabel(user.username) ?? "Plex user"
  );
}
