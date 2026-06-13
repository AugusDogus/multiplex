"use client";

import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { LibraryFilter, LibraryType } from "@multiplex/plex-query";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { getTypeNumber } from "~/lib/library-browse-params";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

interface LibraryControlsProps {
  machineIdentifier: string;
  types: LibraryType[];
  activeType: LibraryType | undefined;
  activeTypeNumber: string | undefined;
  sort: string;
  filters: Record<string, string>;
  totalSize: number;
}

function isBooleanFilter(filter: LibraryFilter): boolean {
  return filter.filterType === "boolean";
}

export function LibraryControls({
  machineIdentifier,
  types,
  activeType,
  activeTypeNumber,
  sort,
  filters,
  totalSize,
}: LibraryControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Tracked so the tag-filter submenus can begin loading their values the
  // moment the filter menu opens, rather than waiting for a submenu hover.
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  const [sortKey, sortDirection] = sort.split(":");

  const reservedKeep = () => {
    const next = new URLSearchParams();
    const source = searchParams.get("source");
    const pivot = searchParams.get("pivot");
    if (source) next.set("source", source);
    if (pivot) next.set("pivot", pivot);
    return next;
  };

  const navigate = (params: URLSearchParams) => {
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const selectType = (typeNumber: string) => {
    // Changing the content type invalidates the current sort and filters
    // (their available options differ per type), so reset to just the type.
    const next = reservedKeep();
    next.set("type", typeNumber);
    navigate(next);
  };

  const selectSort = (key: string, defaultDirection: string) => {
    const next = new URLSearchParams(searchParams.toString());
    const direction =
      key === sortKey
        ? sortDirection === "asc"
          ? "desc"
          : "asc"
        : (defaultDirection ?? "asc");
    next.set("sort", `${key}:${direction}`);
    navigate(next);
  };

  const clearFilters = () => {
    const next = new URLSearchParams(searchParams.toString());
    for (const filter of activeType?.Filter ?? []) {
      next.delete(filter.filter);
    }
    navigate(next);
  };

  const toggleBooleanFilter = (filterName: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (next.get(filterName)) {
      next.delete(filterName);
    } else {
      next.set(filterName, "1");
    }
    navigate(next);
  };

  const selectTagFilter = (filterName: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (next.get(filterName) === value) {
      next.delete(filterName);
    } else {
      next.set(filterName, value);
    }
    navigate(next);
  };

  const availableFilters = activeType?.Filter ?? [];
  const booleanFilters = availableFilters.filter(isBooleanFilter);
  const tagFilters = availableFilters.filter(
    (filter) => !isBooleanFilter(filter),
  );
  const hasActiveFilters = availableFilters.some((filter) =>
    Boolean(filters[filter.filter]),
  );

  const activeSort = activeType?.Sort.find((entry) => entry.key === sortKey);
  const sortLabel = activeSort?.title ?? "Title";

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-2 text-sm">
      {/* Filter menu */}
      <DropdownMenu open={filterMenuOpen} onOpenChange={setFilterMenuOpen}>
        <DropdownMenuTrigger className="hover:bg-accent/60 flex items-center gap-1 rounded-md px-2 py-1 font-medium">
          {hasActiveFilters ? "Filtered" : "All"}
          <ChevronDown className="text-muted-foreground size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh]">
          <DropdownMenuCheckboxItem
            checked={!hasActiveFilters}
            onSelect={() => clearFilters()}
          >
            All
          </DropdownMenuCheckboxItem>
          {booleanFilters.map((filter) => (
            <DropdownMenuCheckboxItem
              key={filter.filter}
              checked={Boolean(filters[filter.filter])}
              onSelect={() => toggleBooleanFilter(filter.filter)}
            >
              {filter.title}
            </DropdownMenuCheckboxItem>
          ))}
          {tagFilters.length > 0 && <DropdownMenuSeparator />}
          {tagFilters.map((filter) => (
            <FilterSubmenu
              key={filter.filter}
              machineIdentifier={machineIdentifier}
              filter={filter}
              activeValue={filters[filter.filter]}
              prefetch={filterMenuOpen}
              onSelectValue={(value) => selectTagFilter(filter.filter, value)}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Type menu */}
      {types.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger className="hover:bg-accent/60 flex items-center gap-1 rounded-md px-2 py-1 font-medium">
            {activeType?.title ?? "Type"}
            <ChevronDown className="text-muted-foreground size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {types.map((type) => {
              const typeNumber = getTypeNumber(type);
              return (
                <DropdownMenuCheckboxItem
                  key={type.key}
                  checked={typeNumber === activeTypeNumber}
                  onSelect={() => {
                    if (typeNumber) {
                      selectType(typeNumber);
                    }
                  }}
                >
                  {type.title}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Sort menu */}
      <DropdownMenu>
        <DropdownMenuTrigger className="hover:bg-accent/60 flex items-center gap-1 rounded-md px-2 py-1 font-medium">
          {sortDirection === "desc" ? (
            <ArrowDown className="text-muted-foreground size-4" />
          ) : (
            <ArrowUp className="text-muted-foreground size-4" />
          )}
          By {sortLabel}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[60vh]">
          {(activeType?.Sort ?? []).map((entry) => {
            const isActive = entry.key === sortKey;
            return (
              <DropdownMenuItem
                key={entry.key}
                onSelect={() =>
                  selectSort(entry.key, entry.defaultDirection ?? "asc")
                }
                className={cn("flex items-center justify-between gap-4")}
              >
                <span>{entry.title}</span>
                {isActive &&
                  (sortDirection === "desc" ? (
                    <ArrowDown className="size-4" />
                  ) : (
                    <ArrowUp className="size-4" />
                  ))}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {totalSize > 0 && (
        <span className="text-muted-foreground ml-1 tabular-nums">
          {totalSize}
        </span>
      )}
    </div>
  );
}

interface FilterSubmenuProps {
  machineIdentifier: string;
  filter: LibraryFilter;
  activeValue: string | undefined;
  /** Begin loading values as soon as the parent filter menu opens. */
  prefetch: boolean;
  onSelectValue: (value: string) => void;
}

function FilterSubmenu({
  machineIdentifier,
  filter,
  activeValue,
  prefetch,
  onSelectValue,
}: FilterSubmenuProps) {
  const { data: values, isLoading } = api.plex.getLibraryFilterValues.useQuery(
    { machineIdentifier, filterPath: filter.key },
    {
      enabled: prefetch,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{filter.title}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-[60vh] overflow-y-auto">
        {isLoading && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
        {!isLoading && (values?.length ?? 0) === 0 && (
          <DropdownMenuItem disabled>No options</DropdownMenuItem>
        )}
        {values?.map((value) => (
          <DropdownMenuCheckboxItem
            key={value.key}
            checked={activeValue === value.key}
            onSelect={() => onSelectValue(value.key)}
          >
            {value.title}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
