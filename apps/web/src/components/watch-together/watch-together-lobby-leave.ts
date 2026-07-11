import type { SessionState } from "@multiplex/plex-query";

export function isSessionForRoom(
  session: SessionState,
  roomId: string,
): boolean {
  return session._tag !== "Idle" && session.room.id === roomId;
}
