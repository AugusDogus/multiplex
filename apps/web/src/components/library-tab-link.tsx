"use client";

import {
  Layers,
  LayoutGrid,
  LibraryBig,
  ListVideo,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { MouseEvent } from "react";
import type { LibraryPivot } from "@multiplex/plex-query";
import {
  SUPPORTED_PIVOT_LABELS,
  isSupportedPivot,
} from "~/lib/library-constants";
import { cn } from "~/lib/utils";

const PIVOT_ICONS: Record<string, LucideIcon> = {
  recommended: Sparkles,
  library: LibraryBig,
  collections: Layers,
  categories: LayoutGrid,
  playlists: ListVideo,
};

interface LibraryTabLinkProps {
  pivot: LibraryPivot;
  href: string;
  isActive: boolean;
  onNavigate: (pivotId: string, href: string) => void;
  registerTab: (pivotId: string, node: HTMLAnchorElement | null) => void;
}

export function LibraryTabLink({
  pivot,
  href,
  isActive,
  onNavigate,
  registerTab,
}: LibraryTabLinkProps) {
  const Icon = PIVOT_ICONS[pivot.id] ?? Sparkles;
  const label = isSupportedPivot(pivot.id)
    ? SUPPORTED_PIVOT_LABELS[pivot.id]
    : pivot.title;

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      isActive ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }

    event.preventDefault();
    onNavigate(pivot.id, href);
  };

  return (
    <Link
      href={href}
      onClick={onClick}
      ref={(node) => {
        registerTab(pivot.id, node);
      }}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "relative z-10 flex shrink-0 items-center rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-200 ease-out md:rounded-full md:border-0 @5xl/appheader:gap-2 @5xl/appheader:px-4",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
        isActive
          ? "text-foreground"
          : "text-muted-foreground hover:border-border/60 hover:bg-muted/50 hover:text-foreground md:hover:bg-transparent",
      )}
    >
      <span className="inline-flex items-center @5xl/appheader:gap-2">
        <Icon
          className={cn(
            "hidden size-4 shrink-0 transition-colors duration-200 ease-out @5xl/appheader:block",
            isActive ? "text-foreground" : "text-muted-foreground",
          )}
        />
        {label}
      </span>
    </Link>
  );
}
