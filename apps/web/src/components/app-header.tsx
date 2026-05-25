import Link from "next/link";
import type { ReactNode } from "react";
import { MultiplexLogo } from "~/components/multiplex-logo";
import { SearchWrapper } from "~/components/search-wrapper";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "~/components/ui/breadcrumb";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";

interface AppHeaderProps {
  /**
   * Breadcrumb / title to display alongside the brand. Omit on the home page
   * since the bottom mobile nav and sidebar already indicate the active tab.
   */
  children?: ReactNode;
}

export function AppHeader({ children }: AppHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2">
      <div className="flex w-full items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1 hidden md:inline-flex" />

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

        {children && (
          <>
            <Separator
              orientation="vertical"
              className="data-[orientation=vertical]:h-4 md:mr-2 md:ml-2"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{children}</BreadcrumbPage>
                </BreadcrumbItem>
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
