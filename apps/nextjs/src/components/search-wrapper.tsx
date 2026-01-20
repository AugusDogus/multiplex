"use client";

import * as React from "react";
import { SearchForm } from "~/components/search-form";
import { SearchCommandModal } from "~/components/search-command-modal";
import type { ProcessedSearchResult } from "~/lib/plex.tv/schemas/search-schemas";

interface SearchWrapperProps {
  className?: string;
}

export function SearchWrapper({ className }: SearchWrapperProps) {
  const [searchModalOpen, setSearchModalOpen] = React.useState(false);

  const handleSearchClick = () => {
    setSearchModalOpen(true);
  };

  const handleResultSelect = (result: ProcessedSearchResult) => {
    // TODO: Implement navigation to media player or details page
    console.log("Selected search result:", result);

    // For now, we'll just log the result. In the future, this could:
    // 1. Navigate to a media player page
    // 2. Open a media details modal
    // 3. Start playback directly
    // 4. Add to a playlist/queue

    // Close the modal after selection
    setSearchModalOpen(false);
  };

  return (
    <>
      <SearchForm className={className} onSearchClick={handleSearchClick} />
      <SearchCommandModal
        open={searchModalOpen}
        onOpenChange={setSearchModalOpen}
        onResultSelect={handleResultSelect}
      />
    </>
  );
}
