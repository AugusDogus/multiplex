import type { ItemMetadata } from "@multiplex/plex-query";

const LIBRARY_PROVIDER_IDENTIFIER = "com.plexapp.plugins.library";
const ITEM_DETAILS_ROUTE_TYPES = [
  "movie",
  "show",
  "season",
  "episode",
] as const;
const ITEM_DETAILS_ROUTE_TYPE_SET: ReadonlySet<string> = new Set(
  ITEM_DETAILS_ROUTE_TYPES,
);

export type ItemDetailsRouteType = (typeof ITEM_DETAILS_ROUTE_TYPES)[number];

export interface PlexBreadcrumb {
  label: string;
  href?: string;
}

type ItemDetailsBreadcrumbInput = Pick<
  ItemMetadata,
  | "type"
  | "title"
  | "librarySectionTitle"
  | "librarySectionID"
  | "grandparentTitle"
  | "grandparentRatingKey"
  | "parentTitle"
  | "parentRatingKey"
>;

interface MetadataAncestor {
  label: string;
  type: ItemDetailsRouteType;
  ratingKey: string;
}

export function getLibraryHref(
  machineIdentifier: string,
  librarySectionID: number | string,
  providerIdentifier = LIBRARY_PROVIDER_IDENTIFIER,
): string {
  return `/media/${machineIdentifier}/${providerIdentifier}?source=${librarySectionID}`;
}

/**
 * Build a library URL targeting a specific pivot (tab), optionally carrying
 * extra params (e.g. a category's filter). The `recommended` pivot is the
 * default and is left implicit.
 */
export function getLibraryPivotHref({
  machineIdentifier,
  sectionId,
  pivot,
  providerIdentifier = LIBRARY_PROVIDER_IDENTIFIER,
  params,
}: {
  machineIdentifier: string;
  sectionId: string;
  pivot: string;
  providerIdentifier?: string;
  params?: Record<string, string>;
}): string {
  const search = new URLSearchParams({ source: sectionId });

  if (pivot && pivot !== "recommended") {
    search.set("pivot", pivot);
  }

  for (const [key, value] of Object.entries(params ?? {})) {
    search.set(key, value);
  }

  return `/media/${machineIdentifier}/${providerIdentifier}?${search.toString()}`;
}

function getMetadataAncestors(
  item: ItemDetailsBreadcrumbInput,
): MetadataAncestor[] {
  const ancestors: MetadataAncestor[] = [];

  if (
    item.type === "episode" &&
    item.grandparentTitle &&
    item.grandparentRatingKey
  ) {
    ancestors.push({
      label: item.grandparentTitle,
      type: "show",
      ratingKey: item.grandparentRatingKey,
    });
  }

  if (
    (item.type === "episode" || item.type === "season") &&
    item.parentTitle &&
    item.parentRatingKey
  ) {
    ancestors.push({
      label: item.parentTitle,
      type: item.type === "episode" ? "season" : "show",
      ratingKey: item.parentRatingKey,
    });
  }

  return ancestors;
}

export function getItemDetailsBreadcrumbs(
  item: ItemDetailsBreadcrumbInput,
  machineIdentifier: string,
): PlexBreadcrumb[] {
  const crumbs: PlexBreadcrumb[] = [
    {
      label: item.librarySectionTitle,
      href: getLibraryHref(machineIdentifier, item.librarySectionID),
    },
  ];

  for (const ancestor of getMetadataAncestors(item)) {
    crumbs.push({
      label: ancestor.label,
      href: getItemDetailsHref(
        machineIdentifier,
        ancestor.type,
        ancestor.ratingKey,
      ),
    });
  }

  crumbs.push({ label: item.title });

  return crumbs;
}

export function getItemDetailsHref(
  machineIdentifier: string,
  type: string,
  ratingKey: string,
): string {
  return `/item/${getItemDetailsRouteType(type)}/${encodeURIComponent(machineIdentifier)}/${encodeURIComponent(ratingKey)}`;
}

export function getItemDetailsRouteType(
  type: string,
): ItemDetailsRouteType | "media" {
  const normalizedType = type.toLowerCase();
  return isItemDetailsRouteType(normalizedType) ? normalizedType : "media";
}

export function isItemDetailsRouteType(
  type: string,
): type is ItemDetailsRouteType {
  return ITEM_DETAILS_ROUTE_TYPE_SET.has(type);
}

/**
 * Resolve where a hub/grid item links to. Most items open their details page;
 * collections and playlists open a hub page listing their children/items.
 */
export function getHubItemHref(
  machineIdentifier: string,
  item: {
    type: string;
    ratingKey: string;
    title: string;
    librarySectionID?: number;
  },
): string {
  if (item.type === "collection") {
    return getHubHref(
      machineIdentifier,
      `/library/collections/${item.ratingKey}/children`,
      item.title,
    );
  }

  if (item.type === "playlist") {
    return getPlaylistHref(
      machineIdentifier,
      item.ratingKey,
      item.librarySectionID,
    );
  }

  return getItemDetailsHref(machineIdentifier, item.type, item.ratingKey);
}

export function getPlaylistHref(
  machineIdentifier: string,
  playlistRatingKey: string,
  librarySectionID?: number,
): string {
  const pathname = `/server/${encodeURIComponent(machineIdentifier)}/playlist/${encodeURIComponent(playlistRatingKey)}`;
  if (
    librarySectionID === undefined ||
    !Number.isSafeInteger(librarySectionID) ||
    librarySectionID <= 0
  ) {
    return pathname;
  }

  const params = new URLSearchParams({
    sectionId: librarySectionID.toString(),
  });
  return `${pathname}?${params.toString()}`;
}

export function getHubHref(
  machineIdentifier: string,
  hubKey: string,
  title: string,
): string {
  const params = new URLSearchParams({
    key: hubKey,
    title,
  });

  return `/server/${machineIdentifier}/hub?${params.toString()}`;
}
