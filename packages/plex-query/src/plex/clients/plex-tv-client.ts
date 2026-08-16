import { z } from "zod";
import {
  rawUserInfoSchema,
  sessionsSchema,
  userInfoSchema,
  type PlexDevice,
  type PinnedSource,
  type PlexUserInfo,
} from "../schemas/plex-tv-schemas";
import {
  parsePlexHomeUsersXml,
  switchedPlexHomeUserSchema,
  type PlexHomeUser,
  type SwitchedPlexHomeUser,
} from "../schemas/plex-home-schemas";
import type { PlexFriend } from "../schemas/watch-together-schemas";
import { PlexAPIError, type PlexConfig } from "../types/client-types";
import {
  PLEX_CLIENTS_API_BASE_URL,
  PLEX_CLIENTS_USER_API_BASE_URL,
  PLEX_TV_API_BASE_URL,
  PlexTvBaseClient,
} from "./plex-tv-base-client";
import { clearPlexServerConnectionCache, PlexServerClient } from "./plex-server-client";

const PLEX_COMMUNITY_API_URL = "https://community.plex.tv/api";
const GET_ALL_FRIENDS_QUERY = `
    query GetAllFriends {
  allFriendsV2 {
    user {
      avatar
      displayName
      id
      username
      idRaw
    }
    createdAt
  }
}
    `;

const plexCommunityFriendSchema = z.object({
  user: z.object({
    avatar: z.string().nullish(),
    displayName: z.string().nullish(),
    id: z.string().min(1),
    username: z.string().nullish(),
    idRaw: z.number().int(),
  }),
});

const plexCommunityFriendsResponseSchema = z.union([
  z.object({
    errors: z.array(z.object({ message: z.string() })).min(1),
  }),
  z.object({
    data: z.object({
      allFriendsV2: z.array(plexCommunityFriendSchema),
    }),
  }),
]);

type PlexCommunityFriend = z.infer<typeof plexCommunityFriendSchema>;
type InviteeSources = Readonly<{
  friends: readonly PlexFriend[];
  sharedUsers: readonly PlexFriend[];
  guest: Pick<PlexHomeUser, "id" | "uuid"> | null;
}>;

/* ────────────────────────────────────────────────────────────
   Plex.tv Client
   Client for interacting with the Plex.tv API
   ──────────────────────────────────────────────────────────── */

/**
 * Client for interacting with the Plex.tv API
 */
export class PlexTvClient extends PlexTvBaseClient {
  private readonly token: string;
  private readonly serverClients = new Map<
    string,
    { fingerprint: string; client: PlexServerClient }
  >();

  private getServerFingerprint(server: PlexDevice): string {
    return JSON.stringify({
      accessToken: server.accessToken ?? this.token,
      owned: server.owned,
      connections: server.connections.map((connection) => ({
        protocol: connection.protocol,
        address: connection.address,
        port: connection.port,
        uri: connection.uri,
        local: connection.local,
        relay: connection.relay,
        IPv6: connection.IPv6,
      })),
    });
  }

  private buildExperienceSettingValue(
    settings: PlexUserInfo["settings"] | undefined,
    pinnedSources: PinnedSource[],
  ): string {
    const experienceSettings: Partial<NonNullable<PlexUserInfo["settings"]>> = settings
      ? { ...settings }
      : {};

    delete experienceSettings.otherSettings;

    return JSON.stringify({
      ...experienceSettings,
      sidebarSettings: {
        ...experienceSettings.sidebarSettings,
        hasCompletedSetup: experienceSettings.sidebarSettings?.hasCompletedSetup ?? true,
        pinnedSources,
      },
    });
  }

  /**
   * @param token - Plex authentication token
   * @param config - Client configuration
   */
  constructor(token: string, config: PlexConfig) {
    super(config);
    this.token = token;
  }

  /**
   * Get list of available Plex Media Servers
   * @returns Array of Plex Media Server devices
   */
  async getServers(): Promise<PlexDevice[]> {
    const data = await this.getResources();

    return data.filter((device) => device.product === "Plex Media Server");
  }

  /** Get every Plex resource visible to the current identity. */
  async getResources(): Promise<PlexDevice[]> {
    return this.get(this.token, {
      endpoint: "resources",
      params: {
        includeHttps: 1,
        includeRelay: 1,
        includeIPv6: 1,
      },
      schema: sessionsSchema,
    });
  }

  /** List the current regular account's Plex Home members. */
  async getHomeUsers(): Promise<PlexHomeUser[]> {
    const url = new URL("https://plex.tv/api/home/users");
    const response = await fetch(url, {
      headers: {
        accept: "application/xml",
        "X-Plex-Token": this.token,
        "X-Plex-Product": this.config.product,
        "X-Plex-Version": this.config.version,
        "X-Plex-Client-Identifier": this.config.clientIdentifier,
        "X-Plex-Platform": this.config.platform,
      },
    });

    if (!response.ok) {
      throw new Error(`Plex Home users request failed: ${response.status}`);
    }

    return parsePlexHomeUsersXml(await response.text());
  }

  /** Return the enabled built-in Guest profile, if this Home has one. */
  async getGuestHomeUser(): Promise<PlexHomeUser | null> {
    const users = await this.getHomeUsers();
    return users.find((user) => user.guest) ?? null;
  }

  /**
   * Switch to a Plex Home profile. Plex Web's current v2 endpoint requires the
   * profile UUID (the older numeric-id route returns 422) and responds as JSON.
   */
  async switchHomeUser(userUuid: string): Promise<SwitchedPlexHomeUser> {
    return this.post(this.token, {
      endpoint: `home/users/${encodeURIComponent(userUuid)}/switch`,
      schema: switchedPlexHomeUserSchema,
      baseUrl: PLEX_TV_API_BASE_URL,
      xPlexOverrides: {
        product: "Plex Web",
      },
    });
  }

  /** Enable Plex Home's built-in Guest using the same private API as Plex Web. */
  async enableGuestHomeUser(homeSize: number): Promise<void> {
    const url = new URL("https://plex.tv/api/home");
    url.searchParams.set("guestEnabled", "1");
    const response = await fetch(url, {
      method: homeSize === 1 ? "POST" : "PUT",
      headers: {
        accept: "application/json",
        "X-Plex-Token": this.token,
        "X-Plex-Product": this.config.product,
        "X-Plex-Version": this.config.version,
        "X-Plex-Client-Identifier": this.config.clientIdentifier,
        "X-Plex-Platform": this.config.platform,
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to enable Plex Home Guest: ${response.status}`);
    }
  }

  /**
   * Get user information
   * @returns User information including subscriptions, providers, and settings
   */
  async getUserInfo(): Promise<PlexUserInfo> {
    const rawData = await this.get(this.token, {
      endpoint: "user",
      params: {
        includeSubscriptions: 1,
        includeProviders: 1,
        includeSettings: 1,
        includeSharedSettings: 1,
      },
      schema: rawUserInfoSchema,
      baseUrl: PLEX_CLIENTS_API_BASE_URL,
      xPlexOverrides: {
        product: "Plex Web",
      },
    });

    // Transform the raw data to get parsed settings
    return userInfoSchema.parse(rawData);
  }

  async updateSidebarPinnedSources(pinnedSources: PinnedSource[]): Promise<void> {
    const userInfo = await this.getUserInfo();
    const experienceValue = this.buildExperienceSettingValue(userInfo.settings, pinnedSources);
    const body = JSON.stringify({
      value: JSON.stringify([
        {
          id: "experience",
          type: "json",
          value: experienceValue,
          hidden: true,
        },
      ]),
    });

    await this.post(this.token, {
      endpoint: "settings",
      params: {
        sharedSettings: 1,
      },
      baseUrl: PLEX_CLIENTS_USER_API_BASE_URL,
      contentType: "application/json",
      body,
      xPlexOverrides: {
        product: "Plex Web",
        sessionId: crypto.randomUUID(),
      },
    });
  }

  async syncViewState(): Promise<void> {
    await this.put(this.token, {
      endpoint: "user/view_state_sync",
      params: {
        context: "tail=false",
        consent: true,
      },
      baseUrl: PLEX_CLIENTS_API_BASE_URL,
      expectEmptyResponse: true,
      xPlexOverrides: {
        product: "Plex Web",
        sessionId: crypto.randomUUID(),
      },
    });
  }

  /**
   * Get the authentication token
   * @returns The Plex authentication token
   */
  getToken(): string {
    return this.token;
  }

  /**
   * Create a server client for a specific Plex Media Server
   * @param server - The server device to create a client for
   * @returns PlexServerClient instance
   */
  createServerClient(server: PlexDevice): PlexServerClient {
    const fingerprint = this.getServerFingerprint(server);
    const cached = this.serverClients.get(server.clientIdentifier);

    if (cached?.fingerprint === fingerprint) {
      return cached.client;
    }

    const client = new PlexServerClient(server, this.token, this.config);
    this.serverClients.set(server.clientIdentifier, { fingerprint, client });
    return client;
  }

  /**
   * Drop a cached server client so the next request re-runs connection discovery.
   */
  invalidateServerClient(serverId: string): void {
    this.serverClients.delete(serverId);
    clearPlexServerConnectionCache(serverId);
  }

  async getFriends(): Promise<PlexFriend[]> {
    const response = await fetch(PLEX_COMMUNITY_API_URL, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
        "X-Plex-Token": this.token,
        "X-Plex-Product": "Plex Web",
        "X-Plex-Version": this.config.version,
        "X-Plex-Client-Identifier": this.config.clientIdentifier,
        "X-Plex-Platform": this.config.platform,
      },
      body: JSON.stringify({
        query: GET_ALL_FRIENDS_QUERY,
        operationName: "GetAllFriends",
      }),
    });
    const result = await this.parseResponse(response, plexCommunityFriendsResponseSchema);

    if ("errors" in result) {
      throw new PlexAPIError(
        `Plex friends request failed: ${result.errors.map((error) => error.message).join("; ")}`,
        response.status,
        response,
      );
    }

    return result.data.allFriendsV2.map(toPlexFriend);
  }

  async getWatchTogetherInvitees(): Promise<PlexFriend[]> {
    const [friends, sharedUsers, guest] = await Promise.all([
      this.getFriends(),
      this.getSharedUsers(),
      this.getGuestHomeUser(),
    ]);
    return mergeWatchTogetherInvitees({ friends, sharedUsers, guest });
  }

  private async getSharedUsers(): Promise<PlexFriend[]> {
    const url = new URL("https://clients.plex.tv/api/users");
    url.searchParams.set("X-Plex-Product", "Plex Web");
    url.searchParams.set("X-Plex-Version", this.config.version);
    url.searchParams.set("X-Plex-Client-Identifier", this.config.clientIdentifier);
    url.searchParams.set("X-Plex-Platform", this.config.platform);
    url.searchParams.set("X-Plex-Token", this.token);

    const response = await fetch(url, {
      headers: { accept: "application/xml" },
    });

    if (!response.ok) {
      throw new Error(`Plex shared users request failed: ${response.status}`);
    }

    return parseSharedUsersXml(await response.text());
  }

  /**
   * Make a GET request to the Plex.tv API
   * @param options - Request options including endpoint, params, schema, and baseUrl
   * @returns Parsed and validated response data
   */
}

function toPlexFriend({ user }: PlexCommunityFriend): PlexFriend {
  const displayName = user.displayName || user.username || "Plex user";
  const username = user.username || user.displayName || "Plex user";

  return {
    id: user.idRaw,
    uuid: user.id,
    title: displayName,
    username,
    friendlyName: displayName,
    thumb: user.avatar || null,
  };
}

function mergeWatchTogetherInvitees({ friends, sharedUsers, guest }: InviteeSources): PlexFriend[] {
  const invitees = new Map<number, PlexFriend>();

  for (const sharedUser of sharedUsers) {
    if (!isGuestIdentity(sharedUser, guest)) {
      invitees.set(sharedUser.id, sharedUser);
    }
  }

  for (const friend of friends) {
    if (isGuestIdentity(friend, guest)) {
      continue;
    }

    const sharedUser = invitees.get(friend.id);
    const restricted = friend.restricted ?? sharedUser?.restricted;
    invitees.set(friend.id, {
      ...sharedUser,
      ...friend,
      restricted,
    });
  }

  return [...invitees.values()].sort((left, right) => {
    return getPlexFriendDisplayName(left).localeCompare(getPlexFriendDisplayName(right));
  });
}

function isGuestIdentity(friend: PlexFriend, guest: InviteeSources["guest"]): boolean {
  return guest !== null && (friend.id === guest.id || friend.uuid === guest.uuid);
}

function getPlexFriendDisplayName(friend: PlexFriend): string {
  return friend.friendlyName ?? friend.title ?? friend.username ?? "Plex user";
}

function parseSharedUsersXml(xml: string): PlexFriend[] {
  const users: PlexFriend[] = [];
  const userMatches = xml.matchAll(/<User\s+([^>]+)>/g);

  for (const match of userMatches) {
    const attrs = parseXmlAttributes(match[1] ?? "");
    const id = Number.parseInt(attrs.id ?? "", 10);
    const username = attrs.username;
    const uuid = attrs.uuid ?? "";

    if (!Number.isFinite(id) || !username) {
      continue;
    }

    users.push({
      id,
      uuid,
      title: attrs.title ?? username,
      username,
      friendlyName: attrs.title ?? username,
      thumb: attrs.thumb,
      restricted: attrs.restricted === "1",
    });
  }

  return users;
}

function parseXmlAttributes(value: string) {
  const matches = value.matchAll(/([A-Za-z0-9_:-]+)="([^"]*)"/g);
  return Object.fromEntries(
    [...matches].flatMap((match) => {
      const [, key, attrValue] = match;
      return key && attrValue !== undefined ? [[key, decodeXmlAttribute(attrValue)]] : [];
    }),
  );
}

function decodeXmlAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
