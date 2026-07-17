import { Command } from "lucide-react";
import Link from "next/link";

import { AppHeaderShell } from "~/components/app-header-shell";
import { Skeleton } from "~/components/ui/skeleton";
import { Separator } from "~/components/ui/separator";
import { SidebarInput, SidebarTrigger } from "~/components/ui/sidebar";
import {
  getAppHeaderSearchSkeletonIconClassName,
  getAppHeaderSearchSkeletonInputClassName,
  getAppHeaderSearchWrapperClassName,
} from "~/lib/app-header-search";
import { cn } from "~/lib/utils";

interface AppHeaderSkeletonProps {
  showBreadcrumb?: boolean;
  /** Grid layout with a centered tab strip skeleton (library pages). */
  center?: boolean;
  /** Library picker skeleton on mobile instead of logo or breadcrumb. */
  mobile?: boolean;
}

export function AppHeaderSkeleton({
  showBreadcrumb = true,
  center = false,
  mobile = false,
}: AppHeaderSkeletonProps) {
  const hasCustomMobile = mobile;
  const hasBreadcrumb = showBreadcrumb;
  const showLogoOnMobile = !hasCustomMobile && !hasBreadcrumb;

  const leading = (
    <>
      <SidebarTrigger className="-ml-1 hidden md:inline-flex" />

      {hasCustomMobile && (
        <div className="flex w-full min-w-0 items-center md:hidden">
          <MobileHeaderSkeleton />
        </div>
      )}

      {showLogoOnMobile && (
        <Link
          href="/"
          aria-label="Multiplex home"
          className="flex shrink-0 items-center gap-2 md:hidden"
        >
          <Command className="size-6" />
          <span className="text-base font-semibold tracking-tight">
            Multiplex
          </span>
        </Link>
      )}

      {hasBreadcrumb && (
        <>
          <Separator
            orientation="vertical"
            className={cn(
              "data-[orientation=vertical]:h-4",
              hasCustomMobile
                ? "hidden md:mr-2 md:ml-2 md:block"
                : "mr-2 ml-2 hidden md:block",
            )}
          />
          <Skeleton
            className={cn(
              "h-6 w-28",
              hasCustomMobile ? "hidden md:block" : undefined,
            )}
          />
        </>
      )}
    </>
  );

  const centerSkeleton = center ? (
    <div
      aria-hidden="true"
      className="md:bg-muted/70 flex w-full max-w-full min-w-0 items-center justify-start gap-2 overflow-hidden py-0.5 md:w-fit md:justify-center md:gap-1 md:rounded-full md:p-1"
    >
      <Skeleton className="h-8 w-28 shrink-0 rounded-lg md:rounded-full" />
      <Skeleton className="h-8 w-24 shrink-0 rounded-lg md:rounded-full" />
      <Skeleton className="hidden h-8 w-24 shrink-0 rounded-lg sm:block md:rounded-full" />
    </div>
  ) : undefined;

  return (
    <AppHeaderShell
      centerLayout={center}
      leading={leading}
      center={centerSkeleton}
      search={
        <SearchChromeSkeleton
          className={getAppHeaderSearchWrapperClassName(center)}
          collapseAtContainer={center}
        />
      }
    />
  );
}

function MobileHeaderSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex max-w-full min-w-0 items-center gap-1.5"
    >
      <div className="grid min-w-0 flex-1 gap-1">
        <Skeleton className="h-4 w-32 max-w-full" />
        <Skeleton className="h-3 w-24 max-w-full" />
      </div>
      <Skeleton className="size-4 shrink-0 rounded-sm" />
    </div>
  );
}

interface SearchChromeSkeletonProps {
  className?: string;
  collapseAtContainer?: boolean;
}

function SearchChromeSkeleton({
  className,
  collapseAtContainer = false,
}: SearchChromeSkeletonProps) {
  return (
    <div className={className} aria-hidden="true">
      <Skeleton
        className={getAppHeaderSearchSkeletonIconClassName(collapseAtContainer)}
      />
      <div
        className={getAppHeaderSearchSkeletonInputClassName(
          collapseAtContainer,
        )}
      >
        <SidebarInput
          placeholder="Search media..."
          className="invisible h-8 pr-12 pl-7"
          readOnly
          tabIndex={-1}
        />
        <Skeleton className="absolute inset-0 rounded-md" />
      </div>
    </div>
  );
}
