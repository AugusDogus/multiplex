"use client";

import * as React from "react";
import { Search } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "~/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { SearchResultItem } from "~/components/search-result-item";
import { useDebounce } from "~/hooks/use-debounce";
import { api } from "~/trpc/react";
import type { ProcessedSearchResult } from "~/lib/plex.tv/schemas/search-schemas";

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
      <DialogContent className="top-[20%] max-h-[80dvh] translate-y-0 overflow-hidden p-0 md:top-[50%] md:translate-y-[-50%]">
        <DialogTitle className="sr-only">Search Plex Media</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search for movies, TV shows, music..."
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            {isLoading && searchQuery.length > 0 && (
              <CommandEmpty>
                <div className="flex items-center justify-center py-6">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span>Searching...</span>
                  </div>
                </div>
              </CommandEmpty>
            )}

            {error && (
              <CommandEmpty>
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <p className="text-muted-foreground text-sm">
                    Search failed. Please try again.
                  </p>
                </div>
              </CommandEmpty>
            )}

            {!isLoading &&
              !error &&
              searchQuery.length > 0 &&
              searchGroups.length === 0 && (
                <CommandEmpty>
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <Search className="text-muted-foreground mb-2 h-8 w-8" />
                    <p className="text-muted-foreground text-sm">
                      No results found for &quot;{searchQuery}&quot;
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
              <CommandGroup key={group.type} heading={group.label}>
                {group.results.map((result) => (
                  <CommandItem
                    key={`${result.serverId}-${result.ratingKey}`}
                    value={`${result.title} ${result.type} ${result.serverName}`}
                    onSelect={() => handleResultSelect(result)}
                    className="cursor-pointer"
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
