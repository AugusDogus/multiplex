import type { ItemMetadata } from "@multiplex/plex-query";

const METADATA_KEY_PATTERN = /^\/library\/metadata\/(\d+)$/;
const LIBRARY_PROVIDER_IDENTIFIER = "com.plexapp.plugins.library";

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
      href: getItemDetailsHref(machineIdentifier, ancestor.ratingKey),
    });
  }

  crumbs.push({ label: item.title });

  return crumbs;
}

export function getItemDetailsHref(
  machineIdentifier: string,
  ratingKey: string,
): string {
  // Plex uses literal metadata keys in URLs; keep this unencoded for compatibility.
  return `/server/${machineIdentifier}/details?key=/library/metadata/${ratingKey}`;
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

export function parseItemDetailsKey(key: string | undefined): string | null {
  if (!key) {
    return null;
  }

  const match = METADATA_KEY_PATTERN.exec(key);
  return match?.[1] ?? null;
}
