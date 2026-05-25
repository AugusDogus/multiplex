"use client";

import {
  BadgeCheck,
  Bell,
  CreditCard,
  Home,
  Library,
  LogOut,
  type LucideIcon,
  Search,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  type PlexDevice,
  type PlexUserInfo,
  type ProcessedSearchResult,
} from "@multiplex/plex-query";
import { LibraryPickerDrawer } from "~/components/library-picker-drawer";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "~/components/ui/drawer";
import { SearchCommandModal } from "~/components/search-command-modal";
import { useServerLibraries } from "~/hooks/use-server-libraries";
import { useSidebarPinning } from "~/hooks/use-sidebar-pinning";
import { getSidebarSources } from "~/hooks/use-sidebar-sources";
import { signOut } from "~/lib/auth/client";
import { cn } from "~/lib/utils";
import { useLastLibraryStore } from "~/stores/last-library-store";

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

  // The picker drawer needs the same data as the sidebar so it can show every
  // server's libraries. We compute the pinned set here too so we can route the
  // tab to the last library the user visited (falling back to the first pin).
  const { currentUserInfo } = useSidebarPinning(userInfo);
  const serverLibraries = useServerLibraries(servers);
  const sidebarSources = getSidebarSources(currentUserInfo, serverLibraries);
  const lastLibraryHref = useLastLibraryStore((state) => state.href);
  const librariesHref =
    lastLibraryHref ?? sidebarSources.pinnedSources[0]?.href;

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
        {librariesHref ? (
          <TabButton
            icon={Library}
            label="Libraries"
            href={librariesHref}
            active={activeTab === "libraries"}
          />
        ) : (
          <TabButton
            icon={Library}
            label="Libraries"
            active={activeTab === "libraries"}
            onClick={() => setLibrariesOpen(true)}
          />
        )}
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

      {/*
        Fallback picker for users without pinned libraries — they can still
        browse every server from the tab. Once pins exist, the tab links
        directly to the first pin and this drawer stays closed.
      */}
      <LibraryPickerDrawer
        open={librariesOpen}
        onOpenChange={setLibrariesOpen}
        servers={servers}
        userInfo={userInfo}
        initialView="all"
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
