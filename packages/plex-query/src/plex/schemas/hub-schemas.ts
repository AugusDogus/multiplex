import { z } from "zod";
import { ContinueWatchingHub, ContinueWatchingMetadata } from "./continue-watching-schemas";

/* ────────────────────────────────────────────────────────────
   Hub & Library Browse Schemas
   ──────────────────────────────────────────────────────────── */

/** Browse/hub metadata omits library section fields that Plex leaves off list responses. */
export const HubMetadataSchema = ContinueWatchingMetadata.extend({
  librarySectionTitle: z.string().optional(),
  librarySectionID: z.number().optional(),
  librarySectionKey: z.string().optional(),
}).passthrough();

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
  const hubs = data.MediaContainer.Hub.map((hub) => ({
    ...hub,
    items: hub.Metadata ?? [],
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
export type Hub = z.infer<typeof HubSchema> & { items: HubItem[] };
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
