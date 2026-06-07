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
   * Replaces the default Multiplex brand + mobile breadcrumb with custom
   * content on mobile only (e.g. a library picker dropdown).
   */
  mobile?: ReactNode;
}

export function AppHeader({ children, breadcrumbs, mobile }: AppHeaderProps) {
  const hasCustomMobile = mobile !== undefined;
  const hasBreadcrumb = breadcrumbs?.length || children;

  return (
    <header className="flex h-16 shrink-0 items-center gap-2">
      <div className="flex w-full items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1 hidden md:inline-flex" />

        {hasCustomMobile ? (
          <div className="flex min-w-0 flex-1 items-center md:hidden">
            {mobile}
          </div>
        ) : (
          <Link
            href="/"
            aria-label="Multiplex home"
            className="flex items-center gap-2 md:hidden"
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
                "data-[orientation=vertical]:h-4 md:mr-2 md:ml-2",
                hasCustomMobile && "hidden md:block",
              )}
            />
            <Breadcrumb className={cn(hasCustomMobile && "hidden md:block")}>
              <BreadcrumbList>
                {breadcrumbs ? (
                  breadcrumbs.map((crumb, index) => (
                    <Fragment key={`${crumb.label}-${index}`}>
                      {index > 0 && <BreadcrumbSeparator />}
                      <BreadcrumbItem>
                        {crumb.href ? (
                          <BreadcrumbLink asChild>
                            <Link href={crumb.href}>{crumb.label}</Link>
                          </BreadcrumbLink>
                        ) : (
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        )}
                      </BreadcrumbItem>
                    </Fragment>
                  ))
                ) : (
                  <BreadcrumbItem>
                    <BreadcrumbPage>{children}</BreadcrumbPage>
                  </BreadcrumbItem>
                )}
              </BreadcrumbList>
            </Breadcrumb>
          </>
        )}

        <div className="ml-auto flex w-auto items-center gap-2">
          {/* Search lives in the bottom nav on mobile. */}
          <SearchWrapper className="hidden w-fit sm:ml-auto sm:w-auto md:block md:w-full" />
        </div>
      </div>
    </header>
  );
}
