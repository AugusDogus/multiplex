import type { SessionState } from "@multiplex/plex-query";

export function isSessionForRoom(
  session: SessionState,
  roomId: string,
): boolean {
  return session._tag !== "Idle" && session.room.id === roomId;
}

/**
 * Which Plex room / session to tear down when the user clicks Leave on a lobby
 * page for `urlRoomId`.
 *
 * {@link WatchTogetherSessionShell} soft-navs the App Router to `SessionState.room`
 * during Playing, so URL and session usually match. This helper still covers the
 * brief window before that navigation commits (and intentional browsing of
 * another lobby while Lobby elsewhere).
 */
export function resolveLobbyLeaveTarget(
  session: SessionState,
  urlRoomId: string,
): { readonly roomId: string; readonly leaveSession: boolean } {
  if (session._tag === "Idle") {
    return { roomId: urlRoomId, leaveSession: false };
  }
  if (session.room.id === urlRoomId) {
    return { roomId: urlRoomId, leaveSession: true };
  }
  // Stale lobby URL before soft-nav commits: leave/delete the live session room.
  if (session._tag === "Playing") {
    return { roomId: session.room.id, leaveSession: true };
  }
  // Viewing a different room's lobby while Lobby elsewhere — only delete the
  // URL room; do not tear down the other session.
  return { roomId: urlRoomId, leaveSession: false };
}
