"use client";

import {
  Heart,
  Loader2,
  MoreVertical,
  RefreshCw,
  Search,
  Server,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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

  const filteredFavorites = useMemo(() => {
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
    filteredFavorites.length > 0 ||
    visibleServers.some(({ sources }) => sources.length > 0);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
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

      {filteredFavorites.length > 0 && (
        <FavoritesSection
          sources={filteredFavorites}
          allPinnedSources={sidebarSources.pinnedSources}
          pendingSourceIdentity={pendingSourceIdentity}
          pathname={pathname}
          searchParams={searchParams}
          onTogglePinnedSource={handleTogglePinnedSource}
        />
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
        <div className="text-muted-foreground py-10 text-center text-sm">
          No libraries match “{filter}”.
        </div>
      )}
    </div>
  );
}

interface FavoritesSectionProps {
  sources: SidebarSource[];
  allPinnedSources: SidebarSource[];
  pendingSourceIdentity: string | null;
  pathname: string;
  searchParams: URLSearchParams;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
}

function FavoritesSection({
  sources,
  allPinnedSources,
  pendingSourceIdentity,
  pathname,
  searchParams,
  onTogglePinnedSource,
}: FavoritesSectionProps) {
  return (
    <section aria-labelledby="favorites-heading">
      <div className="mb-2 flex items-center gap-3 px-1">
        <div className="bg-primary/15 text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
          <Heart aria-hidden className="size-5 fill-current" />
        </div>
        <div className="min-w-0">
          <h2 id="favorites-heading" className="text-base font-semibold">
            Favorites
          </h2>
          <p className="text-muted-foreground truncate text-xs">
            {sources.length} {sources.length === 1 ? "library" : "libraries"}
          </p>
        </div>
      </div>
      <ul className="divide-border divide-y border-y">
        {sources.map((source) => (
          <LibraryRow
            key={source.key}
            source={source}
            active={isUrlActive(pathname, searchParams, source.href)}
            isPinned={isPinnedSource(allPinnedSources, source)}
            isPending={
              pendingSourceIdentity === getPinnedSourceIdentity(source)
            }
            onTogglePinnedSource={onTogglePinnedSource}
          />
        ))}
      </ul>
    </section>
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

  const isOwned = server.owned;
  const headingId = `server-${server.clientIdentifier}`;
  const subtitle = isError
    ? "Server offline"
    : isOwned
      ? (server.sourceTitle ?? null)
      : server.sourceTitle
        ? `Shared by ${server.sourceTitle}`
        : "Remote connection";

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-2 flex items-center gap-3 px-1">
        <ServerAvatar name={server.name} dimmed={isError} />
        <div className="min-w-0 flex-1">
          <h2
            id={headingId}
            className={cn(
              "flex items-center gap-2 text-base font-semibold",
              isError && "text-muted-foreground",
            )}
          >
            <span className="truncate">{server.name}</span>
            {isLoading && (
              <Loader2 className="text-muted-foreground size-3.5 shrink-0 animate-spin" />
            )}
            {isError && (
              <TriangleAlert
                aria-label="Server offline"
                className="text-muted-foreground size-3.5 shrink-0"
              />
            )}
          </h2>
          {subtitle && (
            <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
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
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-9 items-center justify-center rounded-full disabled:opacity-50"
          >
            <RefreshCw
              className={cn("size-4", state.isRetrying && "animate-spin")}
            />
          </button>
        )}
      </div>

      {isLoading && (
        <div className="text-muted-foreground border-y px-1 py-4 text-sm">
          Loading libraries…
        </div>
      )}
      {isError && !isLoading && (
        <div className="text-muted-foreground border-y px-1 py-4 text-sm">
          This server is currently unreachable.
        </div>
      )}
      {!isLoading && !isError && sources.length === 0 && (
        <div className="text-muted-foreground border-y px-1 py-4 text-sm">
          No libraries found.
        </div>
      )}

      {!isLoading && !isError && sources.length > 0 && (
        <ul className="divide-border divide-y border-y">
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

  function handleToggleFavorite(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onTogglePinnedSource(source, isPinned ? "unpin" : "pin");
  }

  function handleMenuToggle() {
    onTogglePinnedSource(source, isPinned ? "unpin" : "pin");
  }

  return (
    <li className="flex items-center">
      <Link
        href={source.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-1 text-base transition-colors",
          active ? "text-foreground font-medium" : "text-foreground",
          "active:bg-accent/40",
        )}
      >
        <Icon
          aria-hidden
          className={cn(
            "size-4 shrink-0",
            active ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="truncate">{source.title}</span>
      </Link>

      <button
        type="button"
        onClick={handleToggleFavorite}
        disabled={isPending}
        aria-label={
          isPinned
            ? `Remove ${source.title} from favorites`
            : `Add ${source.title} to favorites`
        }
        aria-pressed={isPinned}
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50",
          isPinned
            ? "text-foreground hover:bg-accent"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Heart
            className={cn("size-5", isPinned && "fill-current")}
            aria-hidden
          />
        )}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${source.title} options`}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
          >
            <MoreVertical className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={handleMenuToggle}>
            <Heart className={cn("size-4", isPinned && "fill-current")} />
            <span>
              {isPinned ? "Remove from favorites" : "Add to favorites"}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function ServerAvatar({ name, dimmed }: { name: string; dimmed?: boolean }) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        dimmed
          ? "bg-muted text-muted-foreground"
          : "bg-primary/15 text-primary",
      )}
    >
      {initials || <Server className="size-4" />}
    </div>
  );
}
