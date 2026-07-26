import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { AppHeaderShell } from "~/components/app-header-shell";
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
import { getAppHeaderSearchWrapperClassName } from "~/lib/app-header-search";
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
  const centerLayout = center !== undefined;
  const hasCustomMobile = mobile !== undefined;
  const hasBreadcrumb = (breadcrumbs?.length ?? 0) > 0 || Boolean(children);
  const showLogoOnMobile = !hasCustomMobile && !hasBreadcrumb;

  const breadcrumbTrail = breadcrumbs?.length ? (
    breadcrumbs.map((crumb, index) => (
      <Fragment key={`${crumb.href ?? "current"}-${crumb.label}`}>
        {index > 0 && <BreadcrumbSeparator />}
        <BreadcrumbItem className="max-w-[34vw] shrink-0 truncate sm:max-w-none">
          {crumb.href ? (
            <BreadcrumbLink
              render={<Link href={crumb.href} />}
              className="block truncate"
            >
              {crumb.label}
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
        <div className="flex w-full min-w-0 items-center md:hidden">
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

  return (
    <AppHeaderShell
      centerLayout={centerLayout}
      leading={leading}
      center={center}
      search={
        <SearchWrapper
          className={getAppHeaderSearchWrapperClassName(centerLayout)}
          collapseAtContainer={centerLayout}
        />
      }
    />
  );
}
