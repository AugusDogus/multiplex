"use client";

import { useEffect, type ReactNode } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  MULTIPLEX_SYNCPLAY_DEVICE_NAME,
  type SyncplayUser,
} from "@multiplex/plex-query";

import { usePlexClientIdentifier } from "~/lib/device-identifier";
import { sessionCommands, useSessionState } from "~/lib/effect/session-atoms";
import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";
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
  const guestCapability = searchParams.get("guest");
  useWatchTogetherSessionLifecycle(roomId, guestCapability);
  return children;
}

function useWatchTogetherSessionLifecycle(
  roomId: string | null,
  guestCapability: string | null,
) {
  const router = useRouter();
  const sessionState = useSessionState();
  const deviceIdentifier = usePlexClientIdentifier();

  const roomQuery = api.plex.getWatchTogetherRoom.useQuery(
    { roomId: roomId ?? "" },
    {
      enabled: roomId !== null,
      refetchInterval: 10_000,
    },
  );
  const userInfoQuery = api.plex.getUserInfo.useQuery(undefined, {
    staleTime: 60_000,
  });
  const hostContextQuery = api.guestWatchTogether.hostContext.useQuery(
    { capability: guestCapability ?? "" },
    {
      enabled: guestCapability !== null,
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
    const currentRoom = roomQuery.data;
    if (!currentRoom || !localUser) {
      return;
    }
    const hostContext = hostContextQuery.data;
    // A `?guest=` URL must fail closed. Entering this room with the ordinary
    // policy while capability validation is pending or unavailable could
    // restore Plex's all-present auto-start behavior unexpectedly.
    if (
      guestCapability !== null &&
      (!hostContext?.valid || hostContext.roomId !== currentRoom.id)
    ) {
      return;
    }
    sessionCommands.enterLobby({
      room: currentRoom,
      localUser,
      ...(guestCapability !== null && hostContext?.valid
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
    roomQuery.data,
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

  // Session.room is canonical. Soft-nav the App Router segment to match so
  // Leave / close land on the live lobby. Safe now that lifecycle lives here
  // instead of the remounting [roomId] page.
  useEffect(() => {
    if (sessionState._tag !== "Playing") {
      return;
    }
    const href = getWatchTogetherRoomHref(sessionState.room.id);
    if (window.location.pathname === href) {
      return;
    }
    router.replace(href);
  }, [router, sessionState]);
}
