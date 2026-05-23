"use client";

import {
  BadgeCheck,
  Bell,
  ChevronDown,
  CreditCard,
  Home,
  Library,
  Loader2,
  LogOut,
  type LucideIcon,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  type PlexDevice,
  type PlexUserInfo,
  type ProcessedSearchResult,
  getPinnedSourceIdentity,
  isPinnedSource,
} from "@multiplex/plex-query";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";
import { SearchCommandModal } from "~/components/search-command-modal";
import { getSourceIcon, isUrlActive } from "~/components/sidebar-utils";
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
import { signOut } from "~/lib/auth/client";
import { cn } from "~/lib/utils";

interface MobileNavProps {
  session: {
    user: {
      name: string;
      email: string;
      image?: string | null;
    };
  } | null;
  servers: PlexDevice[];
  userInfo: PlexUserInfo;
}

type ActiveTab = "home" | "libraries" | "search" | "you" | null;

export function MobileNav({ session, servers, userInfo }: MobileNavProps) {
  const pathname = usePathname();
  const [librariesOpen, setLibrariesOpen] = useState(false);
  const [youOpen, setYouOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const { currentUserInfo, pendingSourceIdentity, handleTogglePinnedSource } =
    useSidebarPinning(userInfo);
  const serverLibraries = useServerLibraries(servers);
  const sidebarSources = getSidebarSources(currentUserInfo, serverLibraries);

  if (!session) {
    return null;
  }

  // A library page is active when the user is on /media or /live-tv routes.
  const isOnLibraryRoute =
    pathname.startsWith("/media") || pathname.startsWith("/live-tv");

  const activeTab: ActiveTab = librariesOpen
    ? "libraries"
    : youOpen
      ? "you"
      : searchOpen
        ? "search"
        : pathname === "/"
          ? "home"
          : isOnLibraryRoute
            ? "libraries"
            : null;

  const user = {
    name: session.user.name,
    email: session.user.email,
    avatar: session.user.image ?? "",
  };

  function handleSelectSource() {
    setLibrariesOpen(false);
  }

  function handleResultSelect(_result: ProcessedSearchResult) {
    setSearchOpen(false);
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className={cn(
          "bg-background/95 supports-[backdrop-filter]:bg-background/80 fixed inset-x-0 bottom-0 z-40 flex border-t backdrop-blur md:hidden",
          // Respect iOS / Android home indicator safe area.
          "pb-[env(safe-area-inset-bottom)]",
        )}
      >
        <TabButton
          icon={Home}
          label="Home"
          href="/"
          active={activeTab === "home"}
        />
        <TabButton
          icon={Library}
          label="Libraries"
          active={activeTab === "libraries"}
          onClick={() => setLibrariesOpen(true)}
        />
        <TabButton
          icon={Search}
          label="Search"
          active={activeTab === "search"}
          onClick={() => setSearchOpen(true)}
        />
        <TabButton
          label="You"
          active={activeTab === "you"}
          onClick={() => setYouOpen(true)}
          avatar={
            <Avatar className="size-6">
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback className="text-[10px]">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
          }
        />
      </nav>

      <LibrariesDrawer
        open={librariesOpen}
        onOpenChange={setLibrariesOpen}
        servers={servers}
        serverLibraries={serverLibraries}
        sidebarSources={sidebarSources}
        pendingSourceIdentity={pendingSourceIdentity}
        onSelectSource={handleSelectSource}
        onTogglePinnedSource={handleTogglePinnedSource}
      />

      <YouDrawer
        open={youOpen}
        onOpenChange={setYouOpen}
        user={user}
        userInfo={currentUserInfo}
      />

      <SearchCommandModal
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onResultSelect={handleResultSelect}
      />
    </>
  );
}

interface TabButtonProps {
  icon?: LucideIcon;
  avatar?: React.ReactNode;
  label: string;
  active: boolean;
  href?: string;
  onClick?: () => void;
}

function TabButton({
  icon: Icon,
  avatar,
  label,
  active,
  href,
  onClick,
}: TabButtonProps) {
  const className = cn(
    "flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] leading-none transition-colors",
    active
      ? "text-foreground"
      : "text-muted-foreground hover:text-foreground active:text-foreground",
  );

  const content = (
    <>
      {Icon ? (
        <Icon
          aria-hidden
          className={cn("size-5 transition-transform", active && "scale-110")}
        />
      ) : (
        avatar
      )}
      <span className={cn("font-medium", active && "font-semibold")}>
        {label}
      </span>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={className}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={className}
    >
      {content}
    </button>
  );
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// ─── Libraries drawer ────────────────────────────────────────────────────────

interface LibrariesDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servers: PlexDevice[];
  serverLibraries: UseServerLibrariesReturn;
  sidebarSources: UseSidebarSourcesReturn;
  pendingSourceIdentity: string | null;
  onSelectSource: () => void;
  onTogglePinnedSource: (
    source: SidebarSource,
    action: "pin" | "unpin",
  ) => void;
}

function LibrariesDrawer({
  open,
  onOpenChange,
  servers,
  serverLibraries,
  sidebarSources,
  pendingSourceIdentity,
  onSelectSource,
  onTogglePinnedSource,
}: LibrariesDrawerProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="border-b text-left">
          <DrawerTitle>Libraries</DrawerTitle>
          <DrawerDescription>
            Jump to a pinned library or browse every server.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex-1 overflow-y-auto px-2 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          {sidebarSources.pinnedSources.length > 0 && (
            <section className="py-3">
              <h3 className="text-muted-foreground px-3 pb-2 text-xs font-medium tracking-wide uppercase">
                Pinned
              </h3>
              <ul className="flex flex-col">
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
            </section>
          )}

          <section className="py-3">
            <h3 className="text-muted-foreground px-3 pb-2 text-xs font-medium tracking-wide uppercase">
              All servers
            </h3>
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
      </DrawerContent>
    </Drawer>
  );
}

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
          asChild
          className="flex flex-1 items-center gap-2 text-left"
        >
          <button type="button" className="flex items-center gap-2">
            <ChevronDown
              className={cn(
                "size-4 transition-transform",
                !open && "-rotate-90",
              )}
            />
            <span className="text-sm font-medium">{server.name}</span>
            {isLoading && (
              <Loader2 className="text-muted-foreground size-3 animate-spin" />
            )}
            {isError && (
              <TriangleAlert className="text-muted-foreground size-3.5" />
            )}
          </button>
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
        <Icon className="size-4 shrink-0" />
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

// ─── You drawer ──────────────────────────────────────────────────────────────

interface YouDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { name: string; email: string; avatar: string };
  userInfo: PlexUserInfo;
}

function YouDrawer({ open, onOpenChange, user, userInfo }: YouDrawerProps) {
  const hasPlexPass = userInfo.subscription?.active ?? false;
  const subscriptionText = hasPlexPass
    ? userInfo.subscriptionDescription
    : "Upgrade to Pro";
  const subscriptionUrl = hasPlexPass
    ? "https://clients.plex.tv/subscription"
    : "https://www.plex.tv/plans/";

  async function handleSignOut() {
    await signOut();
    window.location.href = "/login";
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="sr-only">
          <DrawerTitle>Your account</DrawerTitle>
          <DrawerDescription>
            Manage your account, subscription, and sign out.
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex flex-col gap-1 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="flex items-center gap-3 px-2 pt-2 pb-4">
            <Avatar className="size-12">
              <AvatarImage src={user.avatar} alt={user.name} />
              <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-base font-semibold">
                {user.name}
              </span>
              <span className="text-muted-foreground truncate text-sm">
                {user.email}
              </span>
            </div>
          </div>

          <YouLink href={subscriptionUrl} icon={Sparkles} external>
            {subscriptionText ?? "Subscription"}
          </YouLink>

          <div className="bg-border my-1 h-px" />

          <YouLink
            href="https://app.plex.tv/desktop/#!/settings/account"
            icon={BadgeCheck}
            external
          >
            Account
          </YouLink>
          <YouLink
            href="https://clients.plex.tv/users/payments"
            icon={CreditCard}
            external
          >
            Billing
          </YouLink>
          <button
            type="button"
            className="text-foreground active:bg-accent/60 flex items-center gap-3 rounded-md px-3 py-3 text-left text-sm"
          >
            <Bell className="size-4" />
            Notifications
          </button>

          <div className="bg-border my-1 h-px" />

          <Button
            type="button"
            variant="ghost"
            onClick={handleSignOut}
            className="justify-start gap-3 px-3 py-3 text-sm"
          >
            <LogOut className="size-4" />
            Log out
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

interface YouLinkProps {
  href: string;
  icon: LucideIcon;
  external?: boolean;
  children: React.ReactNode;
}

function YouLink({ href, icon: Icon, external, children }: YouLinkProps) {
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      className="text-foreground active:bg-accent/60 flex items-center gap-3 rounded-md px-3 py-3 text-sm"
    >
      <Icon className="size-4" />
      {children}
    </a>
  );
}
