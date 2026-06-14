import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { MultiplexLogo } from "~/components/multiplex-logo";
import { SearchWrapper } from "~/components/search-wrapper";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

export interface AppHeaderBreadcrumb {
  label: string;
  href?: string;
}

interface AppHeaderProps {
  /**
   * Single-page breadcrumb label. Prefer `breadcrumbs` for multi-step trails.
   * When both are set, `breadcrumbs` takes precedence.
   */
  children?: ReactNode;
  breadcrumbs?: AppHeaderBreadcrumb[];
  /**
   * Centered header content between the breadcrumb trail and search (e.g. library
   * pivot tabs). On mobile the tabs wrap to a second row; from md up they share
   * one row with breadcrumbs and search.
   */
  center?: ReactNode;
  /**
   * Replaces the default Multiplex brand on mobile only (e.g. a library picker).
   * When omitted, breadcrumbs render on mobile when provided.
   */
  mobile?: ReactNode;
}

export function AppHeader({
  children,
  breadcrumbs,
  center,
  mobile,
}: AppHeaderProps) {
  const hasCustomMobile = mobile !== undefined;
  const hasBreadcrumb = (breadcrumbs?.length ?? 0) > 0 || Boolean(children);
  const showLogoOnMobile = !hasCustomMobile && !hasBreadcrumb;

  const breadcrumbTrail = breadcrumbs?.length ? (
    breadcrumbs.map((crumb, index) => (
      <Fragment key={`${crumb.label}-${index}`}>
        {index > 0 && <BreadcrumbSeparator />}
        <BreadcrumbItem className="max-w-[34vw] shrink-0 truncate sm:max-w-none">
          {crumb.href ? (
            <BreadcrumbLink asChild>
              <Link href={crumb.href} className="block truncate">
                {crumb.label}
              </Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage className="block truncate">
              {crumb.label}
            </BreadcrumbPage>
          )}
        </BreadcrumbItem>
      </Fragment>
    ))
  ) : (
    <BreadcrumbItem>
      <BreadcrumbPage>{children}</BreadcrumbPage>
    </BreadcrumbItem>
  );

  const leading = (
    <>
      <SidebarTrigger className="-ml-1 hidden md:inline-flex" />

      {hasCustomMobile && (
        <div className="flex min-w-0 w-full items-center md:hidden">
          {mobile}
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
          <Breadcrumb
            className={cn(
              "min-w-0",
              hasCustomMobile ? "hidden min-w-0 flex-1 md:block" : "flex-1",
            )}
          >
            <BreadcrumbList className="scrollbar-hide flex-nowrap overflow-x-auto md:flex-wrap md:overflow-visible">
              {breadcrumbTrail}
            </BreadcrumbList>
          </Breadcrumb>
        </>
      )}
    </>
  );

  const search = (
    <SearchWrapper
      className={
        center
          ? "hidden w-fit md:block"
          : "hidden w-fit sm:ml-auto sm:w-auto md:block md:w-full"
      }
      collapseAtContainer={Boolean(center)}
    />
  );

  const searchContainer = (
    <div className="ml-auto flex w-auto shrink-0 items-center gap-2">
      {search}
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
            {center}
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
