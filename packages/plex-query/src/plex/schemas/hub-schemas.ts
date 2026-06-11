import { z } from "zod";
import { ContinueWatchingHub } from "./continue-watching-schemas";

/* ────────────────────────────────────────────────────────────
   Hub & Library Browse Schemas
   ──────────────────────────────────────────────────────────── */

/** List/browse metadata is intentionally looser than item-detail metadata. */
export const HubMetadataSchema = z
  .object({
    ratingKey: z.string(),
    key: z.string(),
    type: z.string(),
    title: z.string(),
    librarySectionTitle: z.string().optional(),
    librarySectionID: z.number().optional(),
    librarySectionKey: z.string().optional(),
    thumb: z.string().optional(),
    parentThumb: z.string().optional(),
    grandparentThumb: z.string().optional(),
    year: z.number().optional(),
    parentTitle: z.string().optional(),
    grandparentTitle: z.string().optional(),
    parentIndex: z.number().optional(),
    index: z.number().optional(),
  })
  .passthrough();

export const HubSchema = ContinueWatchingHub.extend({
  Metadata: z.array(HubMetadataSchema).optional().default([]),
});

export const HubContainerSchema = z.object({
  MediaContainer: z.object({
    size: z.number(),
    allowSync: z.boolean().optional(),
    identifier: z.string().optional(),
    Hub: z.array(HubSchema),
  }),
});

export const LibraryContentContainerSchema = z.object({
  MediaContainer: z
    .object({
      size: z.number(),
      totalSize: z.number().optional(),
      offset: z.number().optional(),
      allowSync: z.boolean().optional(),
      identifier: z.string().optional(),
      librarySectionID: z.number().optional(),
      librarySectionTitle: z.string().optional(),
      librarySectionKey: z.string().optional(),
      viewGroup: z.string().optional(),
      viewMode: z.number().optional(),
      Metadata: z.array(HubMetadataSchema).optional(),
    })
    .passthrough(),
});

export const hubResponseSchema = HubContainerSchema.transform((data) => {
  // Drop the raw `Metadata` array so hub items aren't serialized twice.
  const hubs = data.MediaContainer.Hub.map(({ Metadata, ...hub }) => ({
    ...hub,
    items: Metadata,
  }));

  return {
    serverId: data.MediaContainer.identifier,
    hubs,
  };
});

export const libraryContentResponseSchema = LibraryContentContainerSchema.transform((data) => {
  const container = data.MediaContainer;
  const sectionKey =
    container.librarySectionKey ??
    (container.librarySectionID ? `/library/sections/${container.librarySectionID}` : undefined);

  const items = (container.Metadata ?? []).map((item) => ({
    ...item,
    librarySectionTitle: item.librarySectionTitle ?? container.librarySectionTitle,
    librarySectionID: item.librarySectionID ?? container.librarySectionID,
    librarySectionKey: item.librarySectionKey ?? sectionKey,
  }));

  return {
    items,
    size: container.size,
    totalSize: container.totalSize ?? container.size,
    offset: container.offset ?? 0,
    librarySectionID: container.librarySectionID,
    librarySectionTitle: container.librarySectionTitle,
    viewGroup: container.viewGroup,
  };
});

export type HubItem = z.infer<typeof HubMetadataSchema>;
export type Hub = Omit<z.infer<typeof HubSchema>, "Metadata"> & {
  items: HubItem[];
};
export type HubResponse = z.infer<typeof hubResponseSchema>;
export type LibraryContentResponse = z.infer<typeof libraryContentResponseSchema>;

export type HubItemWithServer = HubItem & {
  serverId: string;
  serverUrl?: string;
  authToken?: string;
  serverName?: string;
};

export type HubWithServer = Omit<Hub, "items"> & {
  items: HubItemWithServer[];
  serverId: string;
};

export type PaginatedHubContent = Pick<
  LibraryContentResponse,
  "items" | "totalSize" | "offset" | "librarySectionTitle"
> & {
  items: HubItemWithServer[];
};
