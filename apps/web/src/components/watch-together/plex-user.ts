export interface PlexUserLike {
  id?: number;
  title?: string | null;
  username?: string | null;
  thumb?: string | null;
}

export function getPlexUserName(user: PlexUserLike): string {
  return user.title ?? user.username ?? "Plex user";
}
