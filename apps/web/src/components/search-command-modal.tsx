"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import {
  Command,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "~/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import type { ProcessedSearchResult } from "@multiplex/plex-query";
import { SearchResultItem } from "~/components/search-result-item";
import { useDebounce } from "~/hooks/use-debounce";
import { api } from "~/trpc/react";

interface SearchCommandModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResultSelect?: (result: ProcessedSearchResult) => void;
}

interface SearchGroup {
  type: string;
  label: string;
  results: ProcessedSearchResult[];
}

export function SearchCommandModal({
  open,
  onOpenChange,
  onResultSelect,
}: SearchCommandModalProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const debouncedQuery = useDebounce(searchQuery, 300);

  const {
    data: searchResults,
    isLoading,
    error,
  } = api.plex.search.useQuery(
    { query: debouncedQuery || "" },
    {
      enabled: Boolean(debouncedQuery && debouncedQuery.length > 0),
      staleTime: 30000, // Cache results for 30 seconds
    },
  );

  // Treat the debounce window as part of "searching" so we don't flash
  // "No results found" while the user is still typing.
  const isDebouncing = searchQuery !== debouncedQuery;
  const isSearching = searchQuery.length > 0 && (isDebouncing || isLoading);

  // Reset search query when modal is closed
  React.useEffect(() => {
    if (!open) {
      setSearchQuery("");
    }
  }, [open]);

  const handleResultSelect = (result: ProcessedSearchResult) => {
    if (onResultSelect) {
      onResultSelect(result);
    }
    onOpenChange(false);
  };

  // Group results by type for display
  const searchGroups: SearchGroup[] = React.useMemo(() => {
    if (!searchResults) return [];

    const groups: SearchGroup[] = [];

    if (searchResults.movies.length > 0) {
      groups.push({
        type: "movies",
        label: "Movies",
        results: searchResults.movies.slice(0, 10), // Limit to top 10 per category
      });
    }

    if (searchResults.tv.length > 0) {
      groups.push({
        type: "tv",
        label: "TV Shows & Episodes",
        results: searchResults.tv.slice(0, 10),
      });
    }

    if (searchResults.music.length > 0) {
      groups.push({
        type: "music",
        label: "Music",
        results: searchResults.music.slice(0, 10),
      });
    }

    if (searchResults.people.length > 0) {
      groups.push({
        type: "people",
        label: "People",
        results: searchResults.people.slice(0, 5), // Fewer people results
      });
    }

    if (searchResults.collections.length > 0) {
      groups.push({
        type: "collections",
        label: "Collections",
        results: searchResults.collections.slice(0, 5),
      });
    }

    return groups;
  }, [searchResults]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-[15%] max-h-[80dvh] translate-y-0 overflow-hidden rounded-xl p-0 sm:max-w-[640px]"
      >
        <DialogTitle className="sr-only">Search Plex Media</DialogTitle>
        <Command shouldFilter={false}>
          <div className="flex items-center justify-between gap-3 border-b p-3">
            <CommandPrimitive.Input
              placeholder="What are you searching for?"
              value={searchQuery}
              onValueChange={setSearchQuery}
              className="placeholder:text-muted-foreground h-7 flex-1 bg-transparent text-base outline-hidden sm:text-lg"
            />
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="bg-background ring-border focus-visible:ring-ring hover:bg-muted ml-auto hidden h-5 cursor-pointer items-center rounded-sm px-1.5 text-xs ring-1 transition-colors focus-visible:ring-2 focus-visible:outline-hidden [@media(hover:hover)_and_(pointer:fine)]:flex"
            >
              Esc
            </button>
          </div>
          <CommandList className="max-h-[436px] p-2">
            {isSearching && (
              <CommandEmpty>
                <div className="flex items-center justify-center py-6">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span>Searching...</span>
                  </div>
                </div>
              </CommandEmpty>
            )}

            {!isSearching && error && (
              <CommandEmpty>
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <p className="text-muted-foreground text-sm">
                    Search failed. Please try again.
                  </p>
                </div>
              </CommandEmpty>
            )}

            {!isSearching &&
              !error &&
              searchQuery.length > 0 &&
              searchGroups.length === 0 && (
                <CommandEmpty>
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <Search className="text-muted-foreground mb-2 h-8 w-8" />
                    <p className="text-muted-foreground text-sm">
                      No results found for &quot;{debouncedQuery}&quot;
                    </p>
                  </div>
                </CommandEmpty>
              )}

            {searchQuery.length === 0 && (
              <CommandEmpty>
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <Search className="text-muted-foreground mb-2 h-8 w-8" />
                  <p className="text-muted-foreground text-sm">
                    Type to search across all your Plex servers
                  </p>
                </div>
              </CommandEmpty>
            )}

            {searchGroups.map((group) => (
              <CommandGroup
                key={group.type}
                heading={group.label}
                className="p-0 **:[[cmdk-group-heading]]:flex **:[[cmdk-group-heading]]:h-10 **:[[cmdk-group-heading]]:items-center **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:text-[13px]"
              >
                {group.results.map((result) => (
                  <CommandItem
                    key={`${result.type}-${result.serverId}-${result.ratingKey}`}
                    value={`${result.title} ${result.type} ${result.serverName}`}
                    onSelect={() => handleResultSelect(result)}
                    className="min-h-16 cursor-pointer scroll-my-2 gap-3 rounded-md px-2 py-1 sm:min-h-12"
                  >
                    <SearchResultItem result={result} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
