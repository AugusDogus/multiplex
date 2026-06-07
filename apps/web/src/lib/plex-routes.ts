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
>;

export function getLibraryHref(
  machineIdentifier: string,
  librarySectionID: number,
  providerIdentifier = LIBRARY_PROVIDER_IDENTIFIER,
): string {
  return `/media/${machineIdentifier}/${providerIdentifier}?source=${librarySectionID}`;
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

  if (
    item.type === "episode" &&
    item.grandparentTitle &&
    item.grandparentRatingKey
  ) {
    crumbs.push({
      label: item.grandparentTitle,
      href: getItemDetailsHref(machineIdentifier, item.grandparentRatingKey),
    });
    crumbs.push({ label: item.title });
  } else {
    crumbs.push({ label: item.title });
  }

  return crumbs;
}

export function getItemDetailsHref(
  machineIdentifier: string,
  ratingKey: string,
): string {
  // Plex encodes key (%2F…), but we keep slashes literal for readability.
  // Safe here: we own the shape and ratingKey is numeric; Next decodes on read.
  return `/server/${machineIdentifier}/details?key=/library/metadata/${ratingKey}`;
}

export function parseItemDetailsKey(key: string | undefined): string | null {
  if (!key) {
    return null;
  }

  const match = METADATA_KEY_PATTERN.exec(key);
  return match?.[1] ?? null;
}
