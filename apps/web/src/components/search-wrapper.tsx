"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { ProcessedSearchResult } from "@multiplex/plex-query";
import { SearchForm } from "~/components/search-form";
import { SearchCommandModal } from "~/components/search-command-modal";
import { PLEX_DETAILS_QUERY_OPTIONS } from "~/lib/plex-details-query-options";
import { getItemDetailsHref } from "~/lib/plex-routes";
import { api } from "~/trpc/react";

interface SearchWrapperProps {
  className?: string;
  collapseAtContainer?: boolean;
}

export function SearchWrapper({
  className,
  collapseAtContainer = false,
}: SearchWrapperProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const [searchModalOpen, setSearchModalOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchModalOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleSearchClick = () => {
    setSearchModalOpen(true);
  };

  const handleResultSelect = (result: ProcessedSearchResult) => {
    setSearchModalOpen(false);
    void utils.plex.getItemDetails.prefetch(
      { serverId: result.serverId, ratingKey: result.ratingKey },
      PLEX_DETAILS_QUERY_OPTIONS,
    );
    router.push(
      getItemDetailsHref(result.serverId, result.type, result.ratingKey),
    );
  };

  return (
    <>
      <SearchForm
        className={className}
        onSearchClick={handleSearchClick}
        collapseAtContainer={collapseAtContainer}
      />
      <SearchCommandModal
        open={searchModalOpen}
        onOpenChange={setSearchModalOpen}
        onResultSelect={handleResultSelect}
      />
    </>
  );
}
