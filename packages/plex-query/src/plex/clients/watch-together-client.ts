import type { PlexConfig } from "../types/client-types";
import { z } from "zod";
import {
  watchTogetherRoomSchema,
  watchTogetherRoomsResponseSchema,
  type WatchTogetherRoom,
} from "../schemas/watch-together-schemas";

const WATCH_TOGETHER_BASE_URL = "https://together.plex.tv";
const emptyResponseSchema = z.void();

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
    return (await this.request("rooms", watchTogetherRoomsResponseSchema)).rooms;
  }

  async getRoom(roomId: string): Promise<WatchTogetherRoom> {
    return this.request(`rooms/${encodeURIComponent(roomId)}`, watchTogetherRoomSchema);
  }

  async createRoom(input: CreateWatchTogetherRoomInput): Promise<WatchTogetherRoom> {
    return this.request("rooms", watchTogetherRoomSchema, {
      method: "POST",
      body: JSON.stringify({
        sourceUri: input.sourceUri,
        title: input.title,
        users: input.users ?? null,
      }),
    });
  }

  async inviteUsers(roomId: string, users: number[]): Promise<void> {
    await this.request(`rooms/${encodeURIComponent(roomId)}/invite`, emptyResponseSchema, {
      method: "POST",
      body: JSON.stringify({ users }),
    });
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.request(
      `rooms/${encodeURIComponent(roomId)}`,
      emptyResponseSchema,
      { method: "DELETE" },
      [404],
    );
  }

  private async request<S extends z.ZodTypeAny>(
    path: string,
    schema: S,
    init: RequestInit = {},
    toleratedStatuses: number[] = [],
  ): Promise<z.output<S>> {
    const url = new URL(path.replace(/^\/+/, ""), WATCH_TOGETHER_BASE_URL);
    const response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-Plex-Token": this.token,
        "X-Plex-Product": this.config.product,
        "X-Plex-Version": this.config.version,
        "X-Plex-Client-Identifier": this.config.clientIdentifier,
        "X-Plex-Platform": this.config.platform,
        "X-Plex-Device": this.config.platform,
        "X-Plex-Device-Name": this.config.product,
        ...init.headers,
      },
    });

    if (toleratedStatuses.includes(response.status)) {
      return schema.parse(undefined);
    }

    if (!response.ok) {
      throw new Error(`Watch Together request failed: ${response.status}`);
    }

    if (response.status === 204) {
      return schema.parse(undefined);
    }

    const text = await response.text();
    return schema.parse(text ? JSON.parse(text) : undefined);
  }
}
