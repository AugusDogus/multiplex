"use client";

import {
  useEffect,
  useEffectEvent,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  MULTIPLEX_SYNCPLAY_DEVICE_NAME,
  type SyncplayUser,
} from "@multiplex/plex-query";

import { usePlexClientIdentifier } from "~/lib/device-identifier";
import { sessionCommands, useSessionState } from "~/lib/effect/session-atoms";
import {
  useSyncedUserInfo,
  useSyncedWatchTogetherRoom,
} from "~/lib/sync-engine";
import {
  getWatchTogetherRoomHref,
  readGuestHostCapability,
  storeGuestHostCapability,
} from "~/lib/watch-together-source";
import { api } from "~/trpc/api";

/**
 * Stable session owner for `/watch-together/*`. Lives in the segment layout so
 * soft-navigating `[roomId]` remounts only the presentational lobby — not
 * enter/exit lifecycle — and Syncplay survives episode rotation.
 */
export function WatchTogetherSessionShell({
  children,
}: {
  children: ReactNode;
}) {
  const params = useParams();
  const searchParams = useSearchParams();
  const roomId = typeof params.roomId === "string" ? params.roomId : null;
  const queryCapability = searchParams.get("guest");
  const storedCapability = useSyncExternalStore<string | null | undefined>(
    subscribeGuestCapability,
    () => (roomId ? readGuestHostCapability(roomId) : null),
    () => undefined,
  );
  const guestCapability = queryCapability ?? storedCapability;

  useEffect(() => {
    if (!roomId || !queryCapability) return;
    storeGuestHostCapability(roomId, queryCapability);
    if (window.location.search.includes("guest=")) {
      window.history.replaceState(
        window.history.state,
        "",
        getWatchTogetherRoomHref(roomId),
      );
    }
  }, [queryCapability, roomId]);

  useWatchTogetherSessionLifecycle(roomId, guestCapability);
  return children;
}

function subscribeGuestCapability(): () => void {
  return () => undefined;
}

function useWatchTogetherSessionLifecycle(
  roomId: string | null,
  guestCapability: string | null | undefined,
) {
  const router = useRouter();
  const sessionState = useSessionState();
  const deviceIdentifier = usePlexClientIdentifier();

  const roomQuery = useSyncedWatchTogetherRoom(roomId, {
    enabled: roomId !== null,
  });
  const userInfoQuery = useSyncedUserInfo();
  const hostContextQuery = api.guestWatchTogether.hostContext.useQuery(
    { capability: guestCapability ?? "" },
    {
      enabled: typeof guestCapability === "string",
      staleTime: 30_000,
      retry: false,
    },
  );

  const localUser: SyncplayUser | null = (() => {
    const localUserId = userInfoQuery.data?.id;
    if (localUserId === undefined || !deviceIdentifier) {
      return null;
    }
    return {
      id: localUserId,
      deviceIdentifier,
      deviceName: MULTIPLEX_SYNCPLAY_DEVICE_NAME,
    };
  })();

  // Enter once room + localUser resolve; re-enter when we return to Idle after
  // closing the player. Idempotent by room id; no-op while Playing (driver
  // owns the socket) except refreshing the same room object.
  useEffect(() => {
    const currentRoom = roomQuery.room;
    if (!currentRoom || !localUser || guestCapability === undefined) {
      return;
    }
    const hostContext = hostContextQuery.data;
    // A `?guest=` URL must fail closed. Entering this room with the ordinary
    // policy while capability validation is pending or unavailable could
    // restore Plex's all-present auto-start behavior unexpectedly.
    if (
      typeof guestCapability === "string" &&
      (!hostContext?.valid || hostContext.roomId !== currentRoom.id)
    ) {
      return;
    }
    sessionCommands.enterLobby({
      room: currentRoom,
      localUser,
      ...(typeof guestCapability === "string" && hostContext?.valid
        ? {
            startPolicy: {
              _tag: "HostControlled" as const,
              localRole: "Host" as const,
              hostUserId: hostContext.hostUserId,
              guestUserId: hostContext.guestUserId,
            },
          }
        : {}),
    });
  }, [
    roomQuery.room,
    localUser,
    sessionState._tag,
    guestCapability,
    hostContextQuery.data,
  ]);

  // Layout stays mounted across roomId soft-navs; only the dependency change
  // runs cleanup. exitLobby is a no-op while Playing, so remounting the page
  // under the modal cannot tear down Syncplay.
  useEffect(() => {
    if (roomId === null) {
      return;
    }
    return () => {
      sessionCommands.exitLobby({ expectedRoomId: roomId });
    };
  }, [roomId]);

  // Keep the App Router segment aligned with Session.room so Leave / close
  // land on the live lobby after episode rotation.
  const replaceRoomPath = useEffectEvent((href: string) => {
    router.replace(href);
  });

  useEffect(() => {
    if (sessionState._tag !== "Playing") {
      return;
    }
    const href = getWatchTogetherRoomHref(sessionState.room.id);
    if (window.location.pathname === href) {
      return;
    }
    replaceRoomPath(href);
  }, [sessionState]);
}
