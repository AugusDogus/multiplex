import {
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
  readonly guestPlex: PlexTvClient;
  readonly guestServer: PlexDevice;
  readonly guestServerClient: PlexServerClient;
  readonly guestServerUrl: string;
  readonly guestDurableToken: string;
  readonly item: PlayableMetadata;
};

export type GuestAccessResolution =
  | { readonly ok: true; readonly value: ResolvedGuestAccess }
  | {
      readonly ok: false;
      readonly reason: GuestAccessFailureReason;
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
    return unavailable("plex-unavailable");
  }

  const currentHomeUser = homeUsers.find(
    (user) => user.id === currentPlexUserId,
  );
  if (!currentHomeUser) {
    return unavailable("not-home-member");
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
    return unavailable("guest-protected");
  }

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

  let guestServers: PlexDevice[];
  try {
    guestServers = await guestPlex.getServers();
  } catch {
    return unavailable("plex-unavailable");
  }
  const guestServer = guestServers.find(
    (server) => server.clientIdentifier === input.serverId,
  );
  const guestDurableToken = guestServer?.accessToken;
  if (!guestServer || !guestDurableToken) {
    return unavailable("server-unavailable");
  }

  const guestServerClient = guestPlex.createServerClient(guestServer);
  let rawItem: Awaited<ReturnType<PlexServerClient["getItemMetadata"]>>;
  try {
    rawItem = await guestServerClient.getItemMetadata(input.ratingKey);
  } catch {
    return unavailable("item-unavailable");
  }
  let guestServerUrl: string;
  try {
    guestServerUrl = await guestServerClient.getConnectionUri();
  } catch {
    return unavailable("server-unavailable");
  }
  const item = rawItem ? toPlayableMetadata(rawItem) : null;
  if (!item) {
    return unavailable("item-unavailable");
  }

  return {
    ok: true,
    value: {
      hostPlexUserId: currentPlexUserId,
      guest,
      guestPlex,
      guestServer,
      guestServerClient,
      guestServerUrl,
      guestDurableToken,
      item,
    },
  };
};

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
