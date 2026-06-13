import Link from "next/link";

import { MultiplexLogo } from "~/components/multiplex-logo";
import { Skeleton } from "~/components/ui/skeleton";
import { Separator } from "~/components/ui/separator";
import { SidebarInput, SidebarTrigger } from "~/components/ui/sidebar";

interface AppHeaderSkeletonProps {
  showBreadcrumb?: boolean;
}

export function AppHeaderSkeleton({
  showBreadcrumb = true,
}: AppHeaderSkeletonProps) {
  return (
    <div className="flex h-16 items-center gap-2 px-4">
      <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
      {showBreadcrumb ? (
        <>
          <Separator
            orientation="vertical"
            className="mr-2 ml-2 hidden data-[orientation=vertical]:h-4 md:block"
          />
          <Skeleton className="h-6 w-28" />
        </>
      ) : (
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
      <div className="ml-auto flex w-auto shrink-0 items-center gap-2">
        <SearchChromeSkeleton className="hidden w-fit sm:ml-auto sm:w-auto md:block md:w-full" />
      </div>
    </div>
  );
}

interface SearchChromeSkeletonProps {
  className?: string;
}

function SearchChromeSkeleton({ className }: SearchChromeSkeletonProps) {
  return (
    <div className={className} aria-hidden="true">
      <div className="relative hidden md:block">
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
