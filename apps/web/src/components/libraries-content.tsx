"use client";

import {
  Loader2,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  type PlexDevice,
  type PlexUserInfo,
  getPinnedSourceIdentity,
  isPinnedSource,
} from "@multiplex/plex-query";
import { getSourceIcon, isUrlActive } from "~/components/sidebar-utils";
import { Input } from "~/components/ui/input";
import {
  type ServerLibraryState,
  useServerLibraries,
} from "~/hooks/use-server-libraries";
import { useSidebarPinning } from "~/hooks/use-sidebar-pinning";
import {
  type SidebarSource,
  getSidebarSources,
} from "~/hooks/use-sidebar-sources";
import { cn } from "~/lib/utils";

interface LibrariesContentProps {
  servers: PlexDevice[];
  userInfo: PlexUserInfo;
}

export function LibrariesContent({ servers, userInfo }: LibrariesContentProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filter, setFilter] = useState("");

  const { currentUserInfo, pendingSourceIdentity, handleTogglePinnedSource } =
    useSidebarPinning(userInfo);
  const serverLibraries = useServerLibraries(servers);
  const sidebarSources = getSidebarSources(currentUserInfo, serverLibraries);

  const normalizedFilter = filter.trim().toLowerCase();

  const filteredPinnedSources = useMemo(() => {
    if (normalizedFilter === "") return sidebarSources.pinnedSources;
    return sidebarSources.pinnedSources.filter((source) =>
      source.title.toLowerCase().includes(normalizedFilter),
    );
  }, [sidebarSources.pinnedSources, normalizedFilter]);

  const visibleServers = useMemo(() => {
    return servers
      .map((server) => {
        const state = serverLibraries.serverStates.get(server.clientIdentifier);
        const sources =
          sidebarSources.librarySourcesByServer[server.clientIdentifier] ?? [];
        const filtered =
          normalizedFilter === ""
            ? sources
            : sources.filter((source) =>
                source.title.toLowerCase().includes(normalizedFilter),
              );
        return {
          server,
          state,
          sources: filtered,
          totalSources: sources.length,
        };
      })
      .filter(({ state, sources, totalSources }) => {
        if (!state) return false;
        if (normalizedFilter === "") return true;
        // While filtering, hide servers that have data but no matches.
        const isError =
          state.error !== null ||
          (state.data?.error ?? null) !== null ||
          state.data === null;
        const isLoading = state.isLoading && !state.isRetrying;
        if (isLoading || isError) return false;
        return sources.length > 0 || totalSources === 0;
      });
  }, [
    servers,
    serverLibraries.serverStates,
    sidebarSources.librarySourcesByServer,
    normalizedFilter,
  ]);

  const hasAnyResults =
    filteredPinnedSources.length > 0 ||
    visibleServers.some(({ sources }) => sources.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-10 -mx-4 px-4 pt-1 pb-3 backdrop-blur md:-mx-6 md:px-6">
        <label className="relative block">
          <Search
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          />
          <Input
            type="search"
            placeholder="Filter libraries"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-10 pl-9"
            aria-label="Filter libraries"
          />
        </label>
      </div>

      {filteredPinnedSources.length > 0 && (
        <section
          aria-labelledby="pinned-heading"
          className="flex flex-col gap-3"
        >
          <SectionHeading id="pinned-heading">Pinned</SectionHeading>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filteredPinnedSources.map((source) => (
              <PinnedTile
                key={source.key}
                source={source}
                active={isUrlActive(pathname, searchParams, source.href)}
                isPending={
                  pendingSourceIdentity === getPinnedSourceIdentity(source)
                }
                onTogglePinnedSource={handleTogglePinnedSource}
              />
            ))}
          </ul>
        </section>
      )}

      {visibleServers.map(({ server, state, sources }) => {
        if (!state) return null;
        return (
          <ServerSection
            key={server.clientIdentifier}
            server={server}
            state={state}
            sources={sources}
            pinnedSources={sidebarSources.pinnedSources}
            pendingSourceIdentity={pendingSourceIdentity}
            pathname={pathname}
            searchParams={searchParams}
            onTogglePinnedSource={handleTogglePinnedSource}
            onRetry={serverLibraries.retryServer}
          />
        );
      })}

      {!hasAnyResults && normalizedFilter !== "" && (
        <div className="text-muted-foreground rounded-lg border border-dashed py-10 text-center text-sm">
          No libraries match “{filter}”.
        </div>
      )}
    </div>
  );
}

function SectionHeading({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
    >
      {children}
    </h2>
  );
}

interface PinnedTileProps {
  source: SidebarSource;
  active: boolean;
  isPending: boolean;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
}

function PinnedTile({
  source,
  active,
  isPending,
  onTogglePinnedSource,
}: PinnedTileProps) {
  const Icon = getSourceIcon(source.sourceType);

  function handleUnpin(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onTogglePinnedSource(source, "unpin");
  }

  return (
    <li className="relative">
      <Link
        href={source.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "border-border bg-card flex h-full items-center gap-3 rounded-lg border p-3 pr-11 transition-colors",
          active
            ? "border-primary/40 bg-accent text-accent-foreground"
            : "hover:bg-accent/40 active:bg-accent/60",
        )}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md",
            active ? "bg-primary/15 text-primary" : "bg-muted text-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{source.title}</span>
          <span className="text-muted-foreground truncate text-xs">
            {source.serverFriendlyName}
          </span>
        </span>
      </Link>
      <button
        type="button"
        onClick={handleUnpin}
        disabled={isPending}
        aria-label={`Unpin ${source.title}`}
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <PinOff className="size-4" />
        )}
      </button>
    </li>
  );
}

interface ServerSectionProps {
  server: PlexDevice;
  state: ServerLibraryState;
  sources: SidebarSource[];
  pinnedSources: SidebarSource[];
  pendingSourceIdentity: string | null;
  pathname: string;
  searchParams: URLSearchParams;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
  onRetry: (serverId: string) => void;
}

function ServerSection({
  server,
  state,
  sources,
  pinnedSources,
  pendingSourceIdentity,
  pathname,
  searchParams,
  onTogglePinnedSource,
  onRetry,
}: ServerSectionProps) {
  const isLoading = state.isLoading && !state.isRetrying;
  const isError =
    state.error !== null ||
    (state.data?.error ?? null) !== null ||
    state.data === null;

  return (
    <section
      aria-labelledby={`server-${server.clientIdentifier}`}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <SectionHeading id={`server-${server.clientIdentifier}`}>
            <span className="truncate">{server.name}</span>
          </SectionHeading>
          {isLoading && (
            <Loader2 className="text-muted-foreground size-3 animate-spin" />
          )}
          {isError && (
            <TriangleAlert
              aria-label="Server offline"
              className="text-muted-foreground size-3.5"
            />
          )}
        </div>
        {isError && (
          <button
            type="button"
            onClick={() => onRetry(server.clientIdentifier)}
            disabled={state.isRetrying}
            aria-label={
              state.isRetrying
                ? "Reconnecting to server"
                : "Retry server connection"
            }
            className="text-muted-foreground hover:text-foreground flex size-8 items-center justify-center rounded-md disabled:opacity-50"
          >
            <RefreshCw
              className={cn("size-4", state.isRetrying && "animate-spin")}
            />
          </button>
        )}
      </div>

      {isLoading && (
        <div className="bg-muted/30 text-muted-foreground rounded-lg border border-dashed px-4 py-4 text-sm">
          Loading libraries…
        </div>
      )}
      {isError && !isLoading && (
        <div className="bg-muted/30 text-muted-foreground rounded-lg border border-dashed px-4 py-4 text-sm">
          This server is offline. Pull to retry.
        </div>
      )}
      {!isLoading && !isError && sources.length === 0 && (
        <div className="text-muted-foreground rounded-lg border border-dashed px-4 py-4 text-sm">
          No libraries found.
        </div>
      )}

      {!isLoading && !isError && sources.length > 0 && (
        <ul className="border-border bg-card divide-border divide-y overflow-hidden rounded-lg border">
          {sources.map((source) => (
            <LibraryRow
              key={source.key}
              source={source}
              active={isUrlActive(pathname, searchParams, source.href)}
              isPinned={isPinnedSource(pinnedSources, source)}
              isPending={
                pendingSourceIdentity === getPinnedSourceIdentity(source)
              }
              onTogglePinnedSource={onTogglePinnedSource}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface LibraryRowProps {
  source: SidebarSource;
  active: boolean;
  isPinned: boolean;
  isPending: boolean;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
}

function LibraryRow({
  source,
  active,
  isPinned,
  isPending,
  onTogglePinnedSource,
}: LibraryRowProps) {
  const Icon = getSourceIcon(source.sourceType);

  function handleTogglePinned(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onTogglePinnedSource(source, isPinned ? "unpin" : "pin");
  }

  return (
    <li className="flex items-center">
      <Link
        href={source.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-sm transition-colors",
          active
            ? "bg-accent text-accent-foreground font-medium"
            : "text-foreground active:bg-accent/60 hover:bg-accent/40",
        )}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            active ? "bg-primary/15 text-primary" : "bg-muted text-foreground",
          )}
        >
          <Icon className="size-4" />
        </span>
        <span className="truncate">{source.title}</span>
      </Link>
      <button
        type="button"
        onClick={handleTogglePinned}
        disabled={isPending}
        aria-label={isPinned ? `Unpin ${source.title}` : `Pin ${source.title}`}
        aria-pressed={isPinned}
        className={cn(
          "mx-1 flex size-9 shrink-0 items-center justify-center rounded-md disabled:opacity-50",
          isPinned
            ? "text-primary hover:text-primary/80"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isPinned ? (
          <PinOff className="size-4" />
        ) : (
          <Pin className="size-4" />
        )}
      </button>
    </li>
  );
}
