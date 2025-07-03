"use client";

import * as React from "react";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "~/components/ui/command";
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
  onResultSelect 
}: SearchCommandModalProps) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [debouncedQuery] = useDebounce(searchQuery, 300);
  
  const { data: searchResults, isLoading, error } = api.plex.search.useQuery(
    { query: debouncedQuery || '' },
    { 
      enabled: Boolean(debouncedQuery && debouncedQuery.length > 0),
      staleTime: 30000, // Cache results for 30 seconds
    }
  );

  // Debug logging
  React.useEffect(() => {
    console.log('🔍 [SearchModal] State:', {
      searchQuery,
      debouncedQuery,
      queryEnabled: Boolean(debouncedQuery && debouncedQuery.length > 0),
      isLoading,
      error: error?.message,
      hasResults: !!searchResults,
      resultCounts: searchResults ? {
        movies: searchResults.movies.length,
        tv: searchResults.tv.length,
        music: searchResults.music.length,
        people: searchResults.people.length,
        collections: searchResults.collections.length,
        total: searchResults.totalResults
      } : null
    });
  }, [searchQuery, debouncedQuery, isLoading, error, searchResults]);

  // Reset search query when modal is closed
  React.useEffect(() => {
    if (!open) {
      setSearchQuery('');
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
    console.log('🔍 [SearchModal] Processing search results:', searchResults);
    
    if (!searchResults) {
      console.log('🔍 [SearchModal] No search results available');
      return [];
    }

    const groups: SearchGroup[] = [];

    if (searchResults.movies.length > 0) {
      const movieGroup = {
        type: 'movies',
        label: 'Movies',
        results: searchResults.movies.slice(0, 10), // Limit to top 10 per category
      };
      groups.push(movieGroup);
      console.log('🔍 [SearchModal] Added movies group:', movieGroup.results.length, 'items');
    }

    if (searchResults.tv.length > 0) {
      const tvGroup = {
        type: 'tv',
        label: 'TV Shows & Episodes',
        results: searchResults.tv.slice(0, 10),
      };
      groups.push(tvGroup);
      console.log('🔍 [SearchModal] Added TV group:', tvGroup.results.length, 'items');
    }

    if (searchResults.music.length > 0) {
      const musicGroup = {
        type: 'music',
        label: 'Music',
        results: searchResults.music.slice(0, 10),
      };
      groups.push(musicGroup);
      console.log('🔍 [SearchModal] Added music group:', musicGroup.results.length, 'items');
    }

    if (searchResults.people.length > 0) {
      const peopleGroup = {
        type: 'people',
        label: 'People',
        results: searchResults.people.slice(0, 5), // Fewer people results
      };
      groups.push(peopleGroup);
      console.log('🔍 [SearchModal] Added people group:', peopleGroup.results.length, 'items');
    }

    if (searchResults.collections.length > 0) {
      const collectionsGroup = {
        type: 'collections',
        label: 'Collections',
        results: searchResults.collections.slice(0, 5),
      };
      groups.push(collectionsGroup);
      console.log('🔍 [SearchModal] Added collections group:', collectionsGroup.results.length, 'items');
    }

    console.log('🔍 [SearchModal] Final groups:', groups.length, 'total groups');
    return groups;
  }, [searchResults]);

  return (
    <CommandDialog 
      open={open} 
      onOpenChange={onOpenChange}
    >
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
              <p className="text-sm text-muted-foreground">
                Search failed. Please try again.
              </p>
            </div>
          </CommandEmpty>
        )}
        
        {!isLoading && !error && searchQuery.length > 0 && searchGroups.length === 0 && (
          <CommandEmpty>
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Search className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No results found for "{searchQuery}"
              </p>
            </div>
          </CommandEmpty>
        )}

        {searchQuery.length === 0 && (
          <CommandEmpty>
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Search className="h-8 w-8 text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Type to search across all your Plex servers
              </p>
            </div>
          </CommandEmpty>
        )}

        {searchGroups.map((group) => {
          console.log(`🔍 [SearchModal] Rendering group: ${group.type} with ${group.results.length} items`);
          return (
            <CommandGroup key={group.type} heading={group.label}>
              {group.results.map((result) => {
                console.log(`🔍 [SearchModal] Rendering item: ${result.title} (${result.type})`);
                return (
                  <CommandItem 
                    key={`${result.serverId}-${result.ratingKey}`}
                    onSelect={() => handleResultSelect(result)}
                    className="cursor-pointer"
                  >
                    <SearchResultItem result={result} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}