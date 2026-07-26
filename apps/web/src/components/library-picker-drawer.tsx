"use client";

import {
  ArrowLeft,
  ChevronDown,
  Film as FilmIcon,
  ListVideo as PlaylistIcon,
  Loader2,
  Music as MusicIcon,
  Pin,
  PinOff,
  Play as DefaultSourceIcon,
  RefreshCw,
  Tv as LiveTvIcon,
  TvMinimal as TvIcon,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  getPinnedSourceIdentity,
  isPinnedSource,
  type PlexDevice,
  type PlexUserInfo,
} from "@multiplex/plex-query";
import { Button } from "~/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
  Drawer,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerPopup,
  DrawerTitle,
} from "~/components/ui/drawer";
import {
  type ServerLibraryState,
  type UseServerLibrariesReturn,
  useServerLibraries,
} from "~/hooks/use-server-libraries";
import { useSidebarPinning } from "~/hooks/use-sidebar-pinning";
import {
  getSidebarSources,
  type SidebarSource,
  type UseSidebarSourcesReturn,
} from "~/hooks/use-sidebar-sources";
import { cn } from "~/lib/utils";
import { isUrlActive } from "./sidebar-utils";

type View = "favorites" | "all";

interface LibraryPickerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servers: PlexDevice[];
  userInfo: PlexUserInfo;
  /** View to show when the drawer opens (default: "favorites"). */
  initialView?: View;
}

export function LibraryPickerDrawer({
  open,
  onOpenChange,
  servers,
  userInfo,
  initialView = "favorites",
}: LibraryPickerDrawerProps) {
  const [view, setView] = useState<View>(initialView);

  const pathname = usePathname();
  const searchParams = useSearchParams();

  const { currentUserInfo, pendingSourceIdentity, handleTogglePinnedSource } =
    useSidebarPinning(userInfo);
  const serverLibraries = useServerLibraries(servers);
  const sidebarSources = getSidebarSources(currentUserInfo, serverLibraries);

  function handleSelectSource() {
    setView(initialView);
    onOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setView(initialView);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerPopup className="max-h-[85vh]" showBar>
        {view === "favorites" ? (
          <FavoritesView
            sidebarSources={sidebarSources}
            pendingSourceIdentity={pendingSourceIdentity}
            pathname={pathname}
            searchParams={searchParams}
            onSelectSource={handleSelectSource}
            onTogglePinnedSource={handleTogglePinnedSource}
            onShowAll={() => setView("all")}
          />
        ) : (
          <AllLibrariesView
            servers={servers}
            serverLibraries={serverLibraries}
            sidebarSources={sidebarSources}
            pendingSourceIdentity={pendingSourceIdentity}
            pathname={pathname}
            searchParams={searchParams}
            onSelectSource={handleSelectSource}
            onTogglePinnedSource={handleTogglePinnedSource}
            onBack={() => setView("favorites")}
          />
        )}
      </DrawerPopup>
    </Drawer>
  );
}

// ─── Favorites view ──────────────────────────────────────────────────────────

interface FavoritesViewProps {
  sidebarSources: UseSidebarSourcesReturn;
  pendingSourceIdentity: string | null;
  pathname: string;
  searchParams: URLSearchParams;
  onSelectSource: () => void;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
  onShowAll: () => void;
}

function FavoritesView({
  sidebarSources,
  pendingSourceIdentity,
  pathname,
  searchParams,
  onSelectSource,
  onTogglePinnedSource,
  onShowAll,
}: FavoritesViewProps) {
  const hasPins = sidebarSources.pinnedSources.length > 0;

  return (
    <>
      <DrawerHeader className="border-b text-left">
        <DrawerTitle>Favorite Libraries</DrawerTitle>
        <DrawerDescription>
          Quick access to the libraries you&apos;ve pinned.
        </DrawerDescription>
      </DrawerHeader>

      <div className="flex-1 overflow-y-auto px-2">
        {hasPins ? (
          <ul className="flex flex-col py-2">
            {sidebarSources.pinnedSources.map((source) => (
              <SourceRow
                key={source.key}
                source={source}
                active={isUrlActive(pathname, searchParams, source.href)}
                isPinned
                isPending={
                  pendingSourceIdentity === getPinnedSourceIdentity(source)
                }
                onSelect={onSelectSource}
                onTogglePinnedSource={onTogglePinnedSource}
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-3 py-6 text-sm">
            You haven&apos;t pinned any libraries yet. Tap{" "}
            <span className="text-foreground font-medium">
              See All Libraries
            </span>{" "}
            to find something to pin.
          </p>
        )}
      </div>

      <DrawerFooter className="border-t pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <Button
          type="button"
          variant="secondary"
          onClick={onShowAll}
          className="w-full"
        >
          See All Libraries
        </Button>
      </DrawerFooter>
    </>
  );
}

// ─── All libraries view ──────────────────────────────────────────────────────

interface AllLibrariesViewProps {
  servers: PlexDevice[];
  serverLibraries: UseServerLibrariesReturn;
  sidebarSources: UseSidebarSourcesReturn;
  pendingSourceIdentity: string | null;
  pathname: string;
  searchParams: URLSearchParams;
  onSelectSource: () => void;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
  onBack: () => void;
}

function AllLibrariesView({
  servers,
  serverLibraries,
  sidebarSources,
  pendingSourceIdentity,
  pathname,
  searchParams,
  onSelectSource,
  onTogglePinnedSource,
  onBack,
}: AllLibrariesViewProps) {
  return (
    <>
      <DrawerHeader className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b text-left">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to favorites"
          className="text-muted-foreground hover:text-foreground -ml-2 flex size-9 items-center justify-center rounded-md"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="text-center">
          <DrawerTitle>All Libraries</DrawerTitle>
        </div>
        {/* Spacer to balance the back button so the title stays centered. */}
        <div className="size-9" />
        <DrawerDescription className="sr-only col-span-3">
          Browse libraries across every server and pin the ones you use most.
        </DrawerDescription>
      </DrawerHeader>

      <div className="flex-1 overflow-y-auto px-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <section className="py-3">
          <div className="flex flex-col gap-1">
            {servers.map((server) => {
              const state = serverLibraries.serverStates.get(
                server.clientIdentifier,
              );
              const sources =
                sidebarSources.librarySourcesByServer[
                  server.clientIdentifier
                ] ?? [];
              if (!state) return null;

              return (
                <MobileServerGroup
                  key={server.clientIdentifier}
                  server={server}
                  state={state}
                  sources={sources}
                  pinnedSources={sidebarSources.pinnedSources}
                  pendingSourceIdentity={pendingSourceIdentity}
                  pathname={pathname}
                  searchParams={searchParams}
                  onSelect={onSelectSource}
                  onTogglePinnedSource={onTogglePinnedSource}
                  onRetry={serverLibraries.retryServer}
                />
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

// ─── Per-server group ────────────────────────────────────────────────────────

interface MobileServerGroupProps {
  server: PlexDevice;
  state: ServerLibraryState;
  sources: SidebarSource[];
  pinnedSources: SidebarSource[];
  pendingSourceIdentity: string | null;
  pathname: string;
  searchParams: URLSearchParams;
  onSelect: () => void;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
  onRetry: (serverId: string) => void;
}

function MobileServerGroup({
  server,
  state,
  sources,
  pinnedSources,
  pendingSourceIdentity,
  pathname,
  searchParams,
  onSelect,
  onTogglePinnedSource,
  onRetry,
}: MobileServerGroupProps) {
  const [open, setOpen] = useState(true);

  const isLoading = state.isLoading && !state.isRetrying;
  const isError =
    state.error !== null ||
    (state.data?.error ?? null) !== null ||
    state.data === null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between px-3 py-1">
        <CollapsibleTrigger
          render={<button type="button" />}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <ChevronDown
            className={cn("size-4 transition-transform", !open && "-rotate-90")}
          />
          <span className="text-sm font-medium">{server.name}</span>
          {isLoading && (
            <Loader2 className="text-muted-foreground size-3 animate-spin" />
          )}
          {isError && (
            <TriangleAlert className="text-muted-foreground size-3.5" />
          )}
        </CollapsibleTrigger>
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
            className="text-muted-foreground hover:text-foreground flex size-7 items-center justify-center rounded-md disabled:opacity-50"
          >
            <RefreshCw
              className={cn("size-4", state.isRetrying && "animate-spin")}
            />
          </button>
        )}
      </div>
      <CollapsibleContent>
        <ul className="flex flex-col pb-1">
          {isLoading && (
            <li className="text-muted-foreground px-9 py-2 text-xs">
              Loading libraries…
            </li>
          )}
          {isError && (
            <li className="text-muted-foreground px-9 py-2 text-xs">
              No libraries available
            </li>
          )}
          {!isLoading && !isError && sources.length === 0 && (
            <li className="text-muted-foreground px-9 py-2 text-xs">
              No libraries found
            </li>
          )}
          {sources.map((source) => (
            <SourceRow
              key={source.key}
              source={source}
              indent
              active={isUrlActive(pathname, searchParams, source.href)}
              isPinned={isPinnedSource(pinnedSources, source)}
              isPending={
                pendingSourceIdentity === getPinnedSourceIdentity(source)
              }
              onSelect={onSelect}
              onTogglePinnedSource={onTogglePinnedSource}
            />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Single source row ───────────────────────────────────────────────────────

interface SourceRowProps {
  source: SidebarSource;
  active: boolean;
  isPinned: boolean;
  isPending: boolean;
  indent?: boolean;
  onSelect: () => void;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
}

function SourceRow({
  source,
  active,
  isPinned,
  isPending,
  indent,
  onSelect,
  onTogglePinnedSource,
}: SourceRowProps) {
  function handleTogglePinned(event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    onTogglePinnedSource(source, isPinned ? "unpin" : "pin");
  }

  return (
    <li className="flex items-center">
      <Link
        href={source.href}
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 rounded-md py-2.5 text-sm",
          indent ? "px-9" : "px-3",
          active
            ? "bg-accent text-accent-foreground font-medium"
            : "text-foreground active:bg-accent/60",
        )}
      >
        <SourceIcon sourceType={source.sourceType} />
        <span className="truncate">{source.title}</span>
      </Link>
      <button
        type="button"
        onClick={handleTogglePinned}
        disabled={isPending}
        aria-label={isPinned ? `Unpin ${source.title}` : `Pin ${source.title}`}
        className="text-muted-foreground hover:text-foreground mx-1 flex size-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50"
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

function SourceIcon({ sourceType }: { sourceType: string }) {
  const className = "size-4 shrink-0";

  switch (sourceType) {
    case "movies":
      return <FilmIcon className={className} />;
    case "tv":
      return <TvIcon className={className} />;
    case "music":
      return <MusicIcon className={className} />;
    case "playlist":
      return <PlaylistIcon className={className} />;
    case "Live TV & DVR":
      return <LiveTvIcon className={className} />;
    default:
      return <DefaultSourceIcon className={className} />;
  }
}
