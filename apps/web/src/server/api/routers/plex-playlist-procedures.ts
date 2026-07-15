import { TRPCError } from "@trpc/server";
import {
  buildLibraryItemUri,
  getPlaylistTypeForItemType,
  playlistTypes,
  PlexAPIError,
  toPublicPlaylistDetail,
  toPublicPlaylistItem,
  type PlaylistDetail,
  type PlexTvClient,
} from "@multiplex/plex-query";
import { z } from "zod";

import { protectedProcedure } from "~/server/api/trpc";
import { resolveServer } from "~/server/api/routers/plex-server";

const playlistRatingKeySchema = z.string().regex(/^[1-9]\d*$/);
const playlistItemIdSchema = z.number().int().positive();
const metadataRatingKeySchema = z.string().regex(/^\d+$/);
const playlistMediaKeySchema = z.string().regex(/^\/library\/metadata\/\d+$/);
const PLAYLIST_REORDER_PAGE_SIZE = 500;
const MAX_REORDERABLE_PLAYLIST_ITEMS = 10_000;

type ServerClient = Awaited<ReturnType<typeof resolveServer>>["serverClient"];

interface PlaylistMutationErrorMessages {
  notFound: string;
  conflict: string;
  unavailable: string;
}

async function runPlaylistMutation<T>(
  operation: () => Promise<T>,
  messages: PlaylistMutationErrorMessages,
): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof PlexAPIError && cause.status === 404) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: messages.notFound,
        cause,
      });
    }
    if (cause instanceof PlexAPIError && cause.status === 409) {
      throw new TRPCError({
        code: "CONFLICT",
        message: messages.conflict,
        cause,
      });
    }
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: messages.unavailable,
      cause,
    });
  }
}

async function fetchPlaylist(
  serverClient: ServerClient,
  playlistRatingKey: string,
): Promise<PlaylistDetail> {
  let playlist: PlaylistDetail | null;
  try {
    playlist = await serverClient.getPlaylist(playlistRatingKey);
  } catch (cause) {
    if (cause instanceof PlexAPIError && cause.status === 404) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Playlist not found",
        cause,
      });
    }

    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Unable to load playlist",
      cause,
    });
  }

  if (!playlist) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Playlist not found" });
  }

  if (
    playlist.ratingKey !== playlistRatingKey ||
    playlist.type !== "playlist"
  ) {
    throw new TRPCError({
      code: "BAD_GATEWAY",
      message: "Plex returned an incompatible playlist",
    });
  }

  return playlist;
}

async function fetchPlaylistProviderAccess(serverClient: ServerClient) {
  try {
    return await serverClient.getPlaylistProviderAccess();
  } catch (cause) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Unable to verify playlist access",
      cause,
    });
  }
}

async function resolveEditablePlaylist(
  plex: PlexTvClient,
  serverId: string,
  playlistRatingKey: string,
) {
  const { serverClient } = await resolveServer(plex, serverId);
  const [playlist, access] = await Promise.all([
    fetchPlaylist(serverClient, playlistRatingKey),
    fetchPlaylistProviderAccess(serverClient),
  ]);

  if (!access.supported || access.readOnly) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This Plex server does not allow playlist editing",
    });
  }

  if (playlist.smart) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Smart playlists are read-only",
    });
  }

  return { serverClient, playlist };
}

async function resolvePlaylistItem(
  serverClient: ServerClient,
  ratingKey: string,
  key: string,
) {
  let item: Awaited<ReturnType<typeof serverClient.getItemMetadata>>;
  try {
    item = await serverClient.getItemMetadata(ratingKey);
  } catch (cause) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Unable to verify playlist item",
      cause,
    });
  }

  if (item?.ratingKey !== ratingKey || item?.key !== key) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Media item not found" });
  }

  return item;
}

async function fetchPlaylistItemIds(
  serverClient: ServerClient,
  playlistRatingKey: string,
  declaredItemCount: number | undefined,
): Promise<number[]> {
  if (
    declaredItemCount !== undefined &&
    declaredItemCount > MAX_REORDERABLE_PLAYLIST_ITEMS
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This playlist is too large to reorder safely",
    });
  }

  if (declaredItemCount === 0) return [];

  const itemIds: number[] = [];
  let start = 0;
  let expectedItemCount = declaredItemCount;

  while (true) {
    const requestedSize =
      expectedItemCount === undefined
        ? PLAYLIST_REORDER_PAGE_SIZE
        : Math.min(
            PLAYLIST_REORDER_PAGE_SIZE,
            Math.max(1, expectedItemCount - itemIds.length),
          );

    let contents: Awaited<ReturnType<typeof serverClient.getPlaylistContents>>;
    try {
      contents = await serverClient.getPlaylistContents(playlistRatingKey, {
        start,
        size: requestedSize,
      });
    } catch (cause) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Unable to verify playlist order",
        cause,
      });
    }

    const container = contents.MediaContainer;
    if (container.totalSize !== undefined) {
      if (container.totalSize > MAX_REORDERABLE_PLAYLIST_ITEMS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This playlist is too large to reorder safely",
        });
      }
      expectedItemCount = container.totalSize;
    }

    const pageItems = container.Metadata ?? [];
    if (pageItems.length === 0) {
      if (
        expectedItemCount !== undefined &&
        itemIds.length < expectedItemCount
      ) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Plex returned an incomplete playlist order",
        });
      }
      return itemIds;
    }

    for (const item of pageItems) {
      if (item.playlistItemID === undefined) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid playlist reorder request",
        });
      }
      itemIds.push(item.playlistItemID);
    }

    if (itemIds.length > MAX_REORDERABLE_PLAYLIST_ITEMS) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This playlist is too large to reorder safely",
      });
    }
    if (
      expectedItemCount !== undefined &&
      itemIds.length >= expectedItemCount
    ) {
      return itemIds;
    }
    if (
      expectedItemCount === undefined &&
      itemIds.length === MAX_REORDERABLE_PLAYLIST_ITEMS
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This playlist is too large to reorder safely",
      });
    }

    const nextStart = (container.offset ?? start) + pageItems.length;
    if (nextStart <= start) {
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: "Plex returned an invalid playlist order",
      });
    }
    start = nextStart;
  }
}

export const playlistProcedures = {
  getPlaylist: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        playlistRatingKey: playlistRatingKeySchema,
      }),
    )
    .query(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);
      const [playlist, access] = await Promise.all([
        fetchPlaylist(serverClient, input.playlistRatingKey),
        fetchPlaylistProviderAccess(serverClient),
      ]);

      return toPublicPlaylistDetail(
        playlist,
        !access.supported || access.readOnly || Boolean(playlist.smart),
      );
    }),

  getPlaylistContents: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        playlistRatingKey: playlistRatingKeySchema,
        start: z.number().int().min(0).default(0),
        size: z.number().int().min(1).max(500).default(100),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);
      await fetchPlaylist(serverClient, input.playlistRatingKey);

      try {
        const response = await serverClient.getPlaylistContents(
          input.playlistRatingKey,
          { start: input.start, size: input.size },
        );
        const container = response.MediaContainer;

        return {
          items: (container.Metadata ?? []).map(toPublicPlaylistItem),
          size: container.size,
          totalSize: container.totalSize ?? container.size,
          offset: container.offset ?? input.start,
        };
      } catch (cause) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Unable to load playlist contents",
          cause,
        });
      }
    }),

  renamePlaylist: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        playlistRatingKey: playlistRatingKeySchema,
        title: z.string().trim().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serverClient } = await resolveEditablePlaylist(
        ctx.plex,
        input.serverId,
        input.playlistRatingKey,
      );
      await runPlaylistMutation(
        () => serverClient.renamePlaylist(input.playlistRatingKey, input.title),
        {
          notFound: "Playlist not found",
          conflict: "A playlist with this name already exists",
          unavailable: "Unable to rename playlist",
        },
      );
      return { success: true };
    }),

  deletePlaylist: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        playlistRatingKey: playlistRatingKeySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serverClient } = await resolveEditablePlaylist(
        ctx.plex,
        input.serverId,
        input.playlistRatingKey,
      );
      await runPlaylistMutation(
        () => serverClient.deletePlaylist(input.playlistRatingKey),
        {
          notFound: "Playlist not found",
          conflict: "The playlist changed before it could be deleted",
          unavailable: "Unable to delete playlist",
        },
      );
      return { success: true };
    }),

  movePlaylistItem: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        playlistRatingKey: playlistRatingKeySchema,
        playlistItemId: playlistItemIdSchema,
        direction: z.enum(["up", "down"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serverClient, playlist } = await resolveEditablePlaylist(
        ctx.plex,
        input.serverId,
        input.playlistRatingKey,
      );

      const itemIds = await fetchPlaylistItemIds(
        serverClient,
        input.playlistRatingKey,
        playlist.leafCount,
      );

      const index = itemIds.indexOf(input.playlistItemId);
      const cannotMove =
        index === -1 ||
        (input.direction === "up" && index === 0) ||
        (input.direction === "down" && index === itemIds.length - 1);
      if (cannotMove) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid playlist reorder request",
        });
      }

      const afterPlaylistItemId =
        input.direction === "down"
          ? itemIds[index + 1]
          : index === 1
            ? undefined
            : itemIds[index - 2];

      await runPlaylistMutation(
        () =>
          serverClient.movePlaylistItem(
            input.playlistRatingKey,
            input.playlistItemId,
            afterPlaylistItemId,
          ),
        {
          notFound: "Playlist or playlist item not found",
          conflict: "The playlist changed before it could be reordered",
          unavailable: "Unable to reorder playlist",
        },
      );
      return { success: true };
    }),

  getItemPlaylists: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        playlistType: z.enum(playlistTypes),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);
      const playlists = await serverClient.getPlaylistsByType(
        input.playlistType,
      );

      return playlists.flatMap((playlist) =>
        playlist.smart
          ? []
          : [
              {
                ratingKey: playlist.ratingKey,
                title: playlist.title,
                leafCount: playlist.leafCount ?? 0,
              },
            ],
      );
    }),

  addItemToPlaylist: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        playlistRatingKey: playlistRatingKeySchema,
        playlistTitle: z.string().optional(),
        ratingKey: metadataRatingKeySchema,
        key: playlistMediaKeySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serverClient, playlist } = await resolveEditablePlaylist(
        ctx.plex,
        input.serverId,
        input.playlistRatingKey,
      );
      const item = await resolvePlaylistItem(
        serverClient,
        input.ratingKey,
        input.key,
      );
      if (playlist.playlistType !== getPlaylistTypeForItemType(item.type)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This item is incompatible with the playlist",
        });
      }

      const response = await runPlaylistMutation(
        () =>
          serverClient.addItemToPlaylist(
            input.playlistRatingKey,
            buildLibraryItemUri(input.serverId, input.ratingKey, input.key),
          ),
        {
          notFound: "Playlist not found",
          conflict: "The item could not be added because the playlist changed",
          unavailable: "Unable to add item to playlist",
        },
      );

      return { leafCountAdded: response.MediaContainer.leafCountAdded ?? 0 };
    }),

  createPlaylistWithItem: protectedProcedure
    .input(
      z.object({
        serverId: z.string(),
        title: z.string().trim().min(1).max(255),
        type: z.enum(playlistTypes),
        ratingKey: metadataRatingKeySchema,
        key: playlistMediaKeySchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { serverClient } = await resolveServer(ctx.plex, input.serverId);
      const access = await fetchPlaylistProviderAccess(serverClient);
      if (!access.supported || access.readOnly) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This Plex server does not allow playlist editing",
        });
      }
      const item = await resolvePlaylistItem(
        serverClient,
        input.ratingKey,
        input.key,
      );
      if (input.type !== getPlaylistTypeForItemType(item.type)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This item is incompatible with the playlist",
        });
      }

      const response = await runPlaylistMutation(
        () =>
          serverClient.createPlaylist({
            title: input.title,
            type: input.type,
            uri: buildLibraryItemUri(
              input.serverId,
              input.ratingKey,
              input.key,
            ),
          }),
        {
          notFound: "Media item not found",
          conflict: "A playlist with this name already exists",
          unavailable: "Unable to create playlist",
        },
      );

      return {
        ratingKey: response.MediaContainer.Metadata?.[0]?.ratingKey ?? null,
        title: response.MediaContainer.Metadata?.[0]?.title ?? input.title,
      };
    }),
};
