"use client";

import * as React from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  Home,
  Monitor,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import type { ProcessedSearchResult } from "@multiplex/plex-query";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from "~/components/ui/command";
import { SearchResultItem } from "~/components/search-result-item";
import { Spinner } from "~/components/ui/spinner";
import { useDebounce } from "~/hooks/use-debounce";
import { SearchAction } from "~/lib/search-actions";
import { useSyncedSearchResults } from "~/lib/sync-engine";

interface SearchCommandModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResultSelect?: (result: ProcessedSearchResult) => void;
}

const actionIcons = {
  home: Home,
  watchlist: Bookmark,
  settings: Settings,
  light: Sun,
  dark: Moon,
  system: Monitor,
};
const mediaGroups = [
  { key: "movies", label: "Movies", limit: 10 },
  { key: "tv", label: "TV Shows & Episodes", limit: 10 },
  { key: "music", label: "Music", limit: 10 },
  { key: "people", label: "People", limit: 5 },
  { key: "collections", label: "Collections", limit: 5 },
] as const;

export function SearchCommandModal({
  open,
  onOpenChange,
  onResultSelect,
}: SearchCommandModalProps) {
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <CommandDialogPopup
          aria-label="Search and actions"
          className="overflow-hidden p-0"
        >
          <SearchCommandContent
            onClose={() => onOpenChange(false)}
            onResultSelect={onResultSelect}
          />
        </CommandDialogPopup>
      )}
    </CommandDialog>
  );
}

function SearchCommandContent({
  onClose,
  onResultSelect,
}: {
  onClose: () => void;
  onResultSelect: SearchCommandModalProps["onResultSelect"];
}) {
  const [query, setQuery] = React.useState("");
  const normalizedQuery = query.trim();
  const debouncedQuery = useDebounce(normalizedQuery, 300);
  const { theme, setTheme } = useTheme();
  const { data, isLoading, error } = useSyncedSearchResults(debouncedQuery);
  const actions = SearchAction.matching(query);
  const searching =
    normalizedQuery.length > 0 &&
    (normalizedQuery !== debouncedQuery || isLoading);
  // Hide the previous query's results while the new query is being resolved.
  const groups =
    normalizedQuery && !searching && !error
      ? mediaGroups.flatMap(({ key, label, limit }) => {
          const results = data?.[key].slice(0, limit) ?? [];
          return results.length ? [{ key, label, results }] : [];
        })
      : [];

  return (
    <Command
      mode="none"
      items={[
        ...actions.map((action) => `action:${action.id}`),
        ...groups.flatMap((group) =>
          group.results.map(
            (result) =>
              `media:${result.type}:${result.serverId}:${result.ratingKey}`,
          ),
        ),
      ]}
      value={query}
      onValueChange={setQuery}
    >
      <CommandInput
        aria-label="Search media and actions"
        placeholder="Search…"
      />
      <CommandPanel>
        <CommandList aria-label="Media and actions">
          {actions.length > 0 && (
            <CommandGroup>
              <CommandGroupLabel>Actions</CommandGroupLabel>
              {actions.map((action) => {
                const Icon =
                  actionIcons[
                    action.kind === "theme" ? action.theme : action.icon
                  ];
                return (
                  <CommandItem
                    key={action.id}
                    value={`action:${action.id}`}
                    render={
                      action.kind === "navigate" ? (
                        <Link href={action.href} />
                      ) : undefined
                    }
                    onClick={() => {
                      if (action.kind === "theme") setTheme(action.theme);
                      onClose();
                    }}
                    className="min-h-10 gap-3 px-2 sm:min-h-9"
                  >
                    <Icon className="text-icon-muted size-4 shrink-0" />
                    <span className="flex-1">{action.label}</span>
                    {action.kind === "theme" && theme === action.theme && (
                      <Check
                        className="text-icon-muted size-4"
                        aria-label="Current mode"
                      />
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
          {groups.map((group) => (
            <CommandGroup key={group.key}>
              <CommandGroupLabel>{group.label}</CommandGroupLabel>
              {group.results.map((result) => (
                <CommandItem
                  key={`${result.type}-${result.serverId}-${result.ratingKey}`}
                  value={`media:${result.type}:${result.serverId}:${result.ratingKey}`}
                  onClick={() => {
                    onResultSelect?.(result);
                    onClose();
                  }}
                  className="min-h-12 scroll-my-2 px-2 py-2"
                >
                  <SearchResultItem result={result} />
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandPanel>
      {searching && (
        <p
          role="status"
          className="text-muted-foreground flex shrink-0 items-center justify-center gap-2 px-4 py-3 text-sm"
        >
          <Spinner className="size-4" />
          Searching media…
        </p>
      )}
      {!searching && normalizedQuery && error && (
        <p
          role="alert"
          className="text-muted-foreground shrink-0 px-4 py-4 text-center text-sm"
        >
          Media search failed. Try another search. App actions are still
          available.
        </p>
      )}
      {!searching &&
        !error &&
        normalizedQuery &&
        groups.length === 0 &&
        actions.length === 0 && (
          <p
            role="status"
            className="text-muted-foreground shrink-0 px-4 py-6 text-center text-sm"
          >
            No results for “{normalizedQuery}”
          </p>
        )}
      <CommandFooter>
        <span className="flex items-center gap-1.5">
          <kbd>
            <ArrowUp />
          </kbd>
          <kbd>
            <ArrowDown />
          </kbd>
          <span>Navigate</span>
        </span>
        <span className="flex items-center gap-1.5">
          <kbd>Enter</kbd>
          <span>Select</span>
        </span>
        <span className="flex items-center gap-1.5">
          <kbd>Esc</kbd>
          <span>Close</span>
        </span>
      </CommandFooter>
    </Command>
  );
}
