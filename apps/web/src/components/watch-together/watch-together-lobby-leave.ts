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
 * After episode rotation the address bar (or a stale Next.js segment) can still
 * show the previous room while {@link SessionState.Playing} has already moved
 * to the next room. Leave must target the live session in that case — guarding
 * only on `urlRoomId` no-ops and strands the viewer on a dead lobby.
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
  // Stale lobby URL after rotation: leave/delete the live session room.
  if (session._tag === "Playing") {
    return { roomId: session.room.id, leaveSession: true };
  }
  // Viewing a different room's lobby while Lobby elsewhere — only delete the
  // URL room; do not tear down the other session.
  return { roomId: urlRoomId, leaveSession: false };
}
