import type { ReactNode } from "react";
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
  children: ReactNode;
}

export function AppHeader({ children }: AppHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2">
      <div className="flex w-full items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
        <Separator
          orientation="vertical"
          className="mr-2 hidden data-[orientation=vertical]:h-4 md:block"
        />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>{children}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="ml-auto flex w-auto items-center gap-2">
          {/* Search lives in the bottom nav on mobile. */}
          <SearchWrapper className="hidden w-fit sm:ml-auto sm:w-auto md:block md:w-full" />
        </div>
      </div>
    </header>
  );
}
