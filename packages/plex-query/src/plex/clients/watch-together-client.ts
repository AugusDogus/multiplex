import type { PlexConfig } from "../types/client-types";
import {
  watchTogetherRoomSchema,
  watchTogetherRoomsResponseSchema,
  type WatchTogetherRoom,
} from "../schemas/watch-together-schemas";

const WATCH_TOGETHER_BASE_URL = "https://together.plex.tv";

interface CreateWatchTogetherRoomInput {
  sourceUri: string;
  title: string;
  users?: number[] | null;
}

export class WatchTogetherClient {
  constructor(
    private readonly token: string,
    private readonly config: PlexConfig,
  ) {}

  async listRooms(): Promise<WatchTogetherRoom[]> {
    const data = await this.request("rooms");
    return watchTogetherRoomsResponseSchema.parse(data).rooms;
  }

  async getRoom(roomId: string): Promise<WatchTogetherRoom> {
    const data = await this.request(`rooms/${roomId}`);
    return watchTogetherRoomSchema.parse(data);
  }

  async createRoom(input: CreateWatchTogetherRoomInput): Promise<WatchTogetherRoom> {
    const data = await this.request("rooms", {
      method: "POST",
      body: JSON.stringify({
        sourceUri: input.sourceUri,
        title: input.title,
        users: input.users ?? null,
      }),
    });

    return watchTogetherRoomSchema.parse(data);
  }

  async inviteUsers(roomId: string, users: number[]): Promise<void> {
    await this.request(`rooms/${roomId}/invite`, {
      method: "POST",
      body: JSON.stringify({ users }),
    });
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.request(`rooms/${roomId}`, { method: "DELETE" }, [404]);
  }

  private async request(
    path: string,
    init: RequestInit = {},
    toleratedStatuses: number[] = [],
  ): Promise<unknown> {
    const url = new URL(path.replace(/^\/+/, ""), WATCH_TOGETHER_BASE_URL);
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-Plex-Token": this.token,
        "X-Plex-Product": "Plex Web",
        "X-Plex-Version": "4.159.0",
        "X-Plex-Client-Identifier": this.config.clientIdentifier,
        "X-Plex-Platform": this.config.platform,
        "X-Plex-Device": this.config.platform,
        "X-Plex-Device-Name": this.config.product,
        ...init.headers,
      },
    });

    if (toleratedStatuses.includes(response.status)) {
      return undefined;
    }

    if (!response.ok) {
      throw new Error(`Watch Together request failed: ${response.status}`);
    }

    if (response.status === 204) {
      return undefined;
    }

    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }
}
