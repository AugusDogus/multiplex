import Link from "next/link";

import { MultiplexLogo } from "~/components/multiplex-logo";
import { Skeleton } from "~/components/ui/skeleton";
import { Separator } from "~/components/ui/separator";
import { SidebarInput, SidebarTrigger } from "~/components/ui/sidebar";
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
        <div className="flex min-w-0 w-full items-center md:hidden">
          <MobileHeaderSkeleton />
        </div>
      )}

      {showLogoOnMobile && (
        <Link
          href="/"
          aria-label="Multiplex home"
          className="flex shrink-0 items-center gap-2 md:hidden"
        >
          <MultiplexLogo className="size-6" />
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

  const search = (
    <SearchChromeSkeleton
      className="hidden w-fit md:block"
      collapseAtContainer={center}
    />
  );

  const searchContainer = (
    <div className="ml-auto flex w-auto shrink-0 items-center gap-2">
      {search}
    </div>
  );

  const centerSkeleton = (
    <div
      aria-hidden="true"
      className="bg-muted/70 flex w-fit max-w-full min-w-0 items-center justify-center gap-1 overflow-hidden rounded-full p-1"
    >
      <Skeleton className="h-8 w-28 rounded-full" />
      <Skeleton className="h-8 w-24 rounded-full" />
      <Skeleton className="hidden h-8 w-24 rounded-full sm:block" />
    </div>
  );

  return (
    <header
      className={cn(
        "@container/appheader flex shrink-0 items-center",
        center ? "min-h-16 md:h-16" : "h-16",
      )}
    >
      {center ? (
        <div className="grid w-full min-w-0 grid-cols-1 items-center gap-y-2 px-4 py-2 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-x-2 md:gap-y-0 md:py-0">
          <div className="flex min-w-0 w-full items-center md:col-start-1 md:w-auto">
            {leading}
          </div>

          <div className="flex min-w-0 justify-center overflow-hidden md:col-start-2">
            {centerSkeleton}
          </div>

          <div className="hidden shrink-0 items-center justify-self-end md:col-start-3 md:flex">
            {search}
          </div>
        </div>
      ) : (
        <div className="flex w-full min-w-0 items-center gap-2 px-4">
          {leading}
          {searchContainer}
        </div>
      )}
    </header>
  );
}

function MobileHeaderSkeleton() {
  return (
    <div aria-hidden="true" className="flex max-w-full min-w-0 items-center gap-1.5">
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
        className={cn(
          "size-8 rounded-md",
          collapseAtContainer
            ? "hidden md:inline-flex @5xl/appheader:hidden"
            : "md:hidden",
        )}
      />
      <div
        className={cn(
          "relative hidden",
          collapseAtContainer ? "@5xl/appheader:block" : "md:block",
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
