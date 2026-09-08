import {
  getServerUrl,
  PlexTvClient,
  toPlayableMetadata,
  type PlayableMetadata,
  type PlexDevice,
  type PlexHomeUser,
  type PlexServerClient,
} from "@multiplex/plex-query";

import { NEXTJS_PLEX_CONFIG } from "~/lib/plex-config";

export type GuestAccessFailureReason =
  | "guest-disabled"
  | "guest-protected"
  | "not-home-member"
  | "guest-switch-failed"
  | "server-unavailable"
  | "item-unavailable"
  | "plex-unavailable";

export type GuestShareEligibility =
  | {
      readonly status: "ready";
      readonly guest: {
        readonly id: number;
        readonly title: string;
      };
    }
  | {
      readonly status: "unavailable";
      readonly reason: GuestAccessFailureReason;
      readonly canEnableGuest: boolean;
    };

export type ResolvedGuestAccess = {
  readonly hostPlexUserId: number;
  readonly guest: PlexHomeUser;
  readonly playbackServerClient: PlexServerClient;
  readonly playbackServerUrl: string;
  readonly item: PlayableMetadata;
};

export type GuestAccessResolution =
  | { readonly ok: true; readonly value: ResolvedGuestAccess }
  | {
      readonly ok: false;
      readonly reason: GuestAccessFailureReason;
      readonly canEnableGuest: boolean;
    };

export type GuestPartyResolution =
  | {
      readonly ok: true;
      readonly hostPlexUserId: number;
      readonly guest: PlexHomeUser;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "guest-disabled"
        | "guest-protected"
        | "not-home-member"
        | "plex-unavailable";
      readonly canEnableGuest: boolean;
    };

export type ResolveGuestAccessOptions = {
  readonly createPlexClient?: (token: string) => PlexTvClient;
};

/** Injectable Guest-access resolver used by bootstrap/continuation services. */
export type ResolveGuestAccess = (
  hostPlex: PlexTvClient,
  input: { serverId: string; ratingKey: string },
  options?: ResolveGuestAccessOptions,
) => Promise<GuestAccessResolution>;

/**
 * Resolve the complete Guest authority chain and prove access to one selected
 * item. Credentials stay in this server-only result and are never serialized.
 */
export const resolveGuestAccess: ResolveGuestAccess = async (
  hostPlex,
  input,
  options = {},
) => {
  const party = await resolveGuestParty(hostPlex);
  if (!party.ok) return party;

  const { guest, hostPlexUserId: currentPlexUserId } = party;
  let switchedToken: string;
  try {
    const switched = await hostPlex.switchHomeUser(guest.uuid);
    if (!switched.guest) {
      return unavailable("guest-switch-failed");
    }
    switchedToken = switched.authToken;
  } catch {
    return unavailable("guest-switch-failed");
  }

  const createPlexClient =
    options.createPlexClient ??
    ((token: string) => new PlexTvClient(token, NEXTJS_PLEX_CONFIG));
  const guestPlex = createPlexClient(switchedToken);

  const guestPlayback = await resolvePlaybackAccess(guestPlex, input);
  const playback = guestPlayback.ok
    ? guestPlayback
    : await resolvePlaybackAccess(hostPlex, input);
  if (!playback.ok) {
    return unavailable(playback.reason);
  }

  return {
    ok: true,
    value: {
      hostPlexUserId: currentPlexUserId,
      guest,
      playbackServerClient: playback.serverClient,
      playbackServerUrl: playback.serverUrl,
      item: playback.item,
    },
  };
};

/** Resolve only the Plex Home party, without touching a media server. */
export async function resolveGuestParty(
  hostPlex: Pick<PlexTvClient, "getHomeUsers" | "getUserInfo">,
): Promise<GuestPartyResolution> {
  let homeUsers: PlexHomeUser[];
  let currentPlexUserId: number;
  try {
    const [users, userInfo] = await Promise.all([
      hostPlex.getHomeUsers(),
      hostPlex.getUserInfo(),
    ]);
    homeUsers = users;
    currentPlexUserId = userInfo.id;
  } catch {
    return {
      ok: false,
      reason: "plex-unavailable",
      canEnableGuest: false,
    };
  }

  const currentHomeUser = homeUsers.find(
    (user) => user.id === currentPlexUserId,
  );
  if (!currentHomeUser) {
    return {
      ok: false,
      reason: "not-home-member",
      canEnableGuest: false,
    };
  }

  const guest = homeUsers.find((user) => user.guest);
  if (!guest) {
    return {
      ok: false,
      reason: "guest-disabled",
      canEnableGuest: currentHomeUser.admin,
    };
  }
  if (guest.protected) {
    return {
      ok: false,
      reason: "guest-protected",
      canEnableGuest: false,
    };
  }

  return {
    ok: true,
    hostPlexUserId: currentPlexUserId,
    guest,
  };
}

type PlaybackAccessResolution =
  | {
      readonly ok: true;
      readonly serverClient: PlexServerClient;
      readonly serverUrl: string;
      readonly item: PlayableMetadata;
    }
  | {
      readonly ok: false;
      readonly reason:
        | "server-unavailable"
        | "item-unavailable"
        | "plex-unavailable";
    };

async function resolvePlaybackAccess(
  plex: PlexTvClient,
  input: { readonly serverId: string; readonly ratingKey: string },
): Promise<PlaybackAccessResolution> {
  let servers: PlexDevice[];
  try {
    servers = await plex.getServers();
  } catch {
    return { ok: false, reason: "plex-unavailable" };
  }
  const server = servers.find(
    (server) => server.clientIdentifier === input.serverId,
  );
  if (!server?.accessToken) {
    return { ok: false, reason: "server-unavailable" };
  }

  const serverClient = plex.createServerClient(server);
  let rawItem: Awaited<ReturnType<PlexServerClient["getItemMetadata"]>>;
  try {
    rawItem = await serverClient.getItemMetadata(input.ratingKey);
  } catch {
    return { ok: false, reason: "item-unavailable" };
  }
  // Connection discovery runs on the Next.js server, whose fastest working
  // origin may be a LAN address that an invited guest cannot reach. Hand the
  // browser the advertised remote HTTPS origin instead, matching the normal
  // signed-in playback path.
  const serverUrl = getServerUrl(server);
  if (!serverUrl) {
    return { ok: false, reason: "server-unavailable" };
  }
  const item = rawItem ? toPlayableMetadata(rawItem) : null;
  if (!item) {
    return { ok: false, reason: "item-unavailable" };
  }

  return {
    ok: true,
    serverClient,
    serverUrl,
    item,
  };
}

export function toGuestShareEligibility(
  resolution: GuestAccessResolution,
): GuestShareEligibility {
  if (!resolution.ok) {
    return {
      status: "unavailable",
      reason: resolution.reason,
      canEnableGuest: resolution.canEnableGuest,
    };
  }
  return {
    status: "ready",
    guest: {
      id: resolution.value.guest.id,
      title: resolution.value.guest.title,
    },
  };
}

export async function enableGuestForCurrentHome(
  hostPlex: PlexTvClient,
): Promise<GuestShareEligibility> {
  let homeUsers: PlexHomeUser[];
  let currentPlexUserId: number;
  try {
    const [users, userInfo] = await Promise.all([
      hostPlex.getHomeUsers(),
      hostPlex.getUserInfo(),
    ]);
    homeUsers = users;
    currentPlexUserId = userInfo.id;
  } catch {
    return toGuestShareEligibility(unavailable("plex-unavailable"));
  }

  const current = homeUsers.find((user) => user.id === currentPlexUserId);
  if (!current) {
    return toGuestShareEligibility(unavailable("not-home-member"));
  }
  const existingGuest = homeUsers.find((user) => user.guest);
  if (existingGuest) {
    return {
      status: "ready",
      guest: { id: existingGuest.id, title: existingGuest.title },
    };
  }
  if (!current.admin) {
    return {
      status: "unavailable",
      reason: "guest-disabled",
      canEnableGuest: false,
    };
  }

  try {
    await hostPlex.enableGuestHomeUser(homeUsers.length);
    const enabledGuest = (await hostPlex.getHomeUsers()).find(
      (user) => user.guest,
    );
    return enabledGuest
      ? {
          status: "ready",
          guest: { id: enabledGuest.id, title: enabledGuest.title },
        }
      : toGuestShareEligibility(unavailable("guest-disabled"));
  } catch {
    return toGuestShareEligibility(unavailable("plex-unavailable"));
  }
}

function unavailable(
  reason:
    | Exclude<GuestAccessFailureReason, "guest-disabled">
    | "guest-disabled",
): Extract<GuestAccessResolution, { ok: false }> {
  return { ok: false, reason, canEnableGuest: false };
}
