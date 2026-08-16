import type { LibraryMetaResponse, LibraryType } from "@multiplex/plex-query";

/** Search params the Library tab reserves for its own controls. */
export const RESERVED_LIBRARY_PARAMS = new Set([
  "source",
  "pivot",
  "type",
  "sort",
]);

const TYPE_PARAM_PATTERN = /[?&]type=(\d+)/;

/** Numeric Plex `type` encoded in a metadata type's `key`, if any. */
export function getTypeNumber(type: LibraryType): string | undefined {
  return TYPE_PARAM_PATTERN.exec(type.key)?.[1];
}

/**
 * Metadata types that map to a `library/sections/{id}/all?type=N` grid (i.e.
 * excluding "Folders", which uses a separate hierarchical endpoint).
 */
export function getGridTypes(meta: LibraryMetaResponse): LibraryType[] {
  return meta.types.filter((type) => getTypeNumber(type) !== undefined);
}

export interface ResolvedLibraryType {
  type: LibraryType | undefined;
  typeNumber: string | undefined;
}

export function resolveActiveType(
  meta: LibraryMetaResponse,
  requestedType: string | undefined,
): ResolvedLibraryType {
  const gridTypes = getGridTypes(meta);

  if (requestedType) {
    const requested = gridTypes.find(
      (type) => getTypeNumber(type) === requestedType,
    );
    if (requested) {
      return { type: requested, typeNumber: requestedType };
    }
  }

  const active = gridTypes.find((type) => type.active) ?? gridTypes[0];
  return {
    type: active,
    typeNumber: active ? getTypeNumber(active) : undefined,
  };
}

/** Resolve the effective `sort` (`key:direction`) for a content type. */
export function resolveSort(
  type: LibraryType | undefined,
  requestedSort: string | undefined,
): string {
  if (requestedSort) {
    return requestedSort;
  }

  const activeSort = type?.Sort.find((sort) => sort.active) ?? type?.Sort[0];
  if (!activeSort) {
    return "titleSort:asc";
  }

  const direction =
    activeSort.activeDirection ?? activeSort.defaultDirection ?? "asc";
  return `${activeSort.key}:${direction}`;
}

/** Collect non-reserved search params as Plex library filters. */
export function extractLibraryFilters(
  searchParams: Record<string, string | string[] | undefined>,
) {
  const filters = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (RESERVED_LIBRARY_PARAMS.has(key)) {
      continue;
    }
    // Never let a URL param masquerade as a Plex control param (e.g.
    // `X-Plex-Container-Size`) and override pagination/auth downstream.
    if (key.startsWith("X-Plex-")) {
      continue;
    }
    if (value !== undefined && !Array.isArray(value) && value !== "") {
      filters.set(key, value);
    }
  }

  return Object.fromEntries(filters);
}

/** Stable identity for the current type/sort/filter combination. */
export function buildLibraryContentKey(input: {
  machineIdentifier: string;
  sectionId: string;
  typeNumber: string | undefined;
  sort: string;
  filters: Record<string, string>;
}): string {
  const filterKey = Object.entries(input.filters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  return [
    input.machineIdentifier,
    input.sectionId,
    input.typeNumber ?? "",
    input.sort,
    filterKey,
  ].join("|");
}
