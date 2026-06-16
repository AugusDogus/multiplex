import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

interface AppHeaderShellProps {
  centerLayout: boolean;
  leading: ReactNode;
  center?: ReactNode;
  search: ReactNode;
}

export function AppHeaderShell({
  centerLayout,
  leading,
  center,
  search,
}: AppHeaderShellProps) {
  return (
    <header
      className={cn(
        "@container/appheader flex shrink-0 items-center",
        centerLayout ? "min-h-16 md:h-16" : "h-16",
      )}
    >
      {centerLayout ? (
        <div className="flex w-full min-w-0 items-center gap-3 px-4 py-2 md:grid md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-x-2 md:py-0">
          <div className="flex min-w-0 max-w-[42vw] shrink-0 items-center md:col-start-1 md:max-w-none md:w-auto">
            {leading}
          </div>

          <div className="flex min-w-0 flex-1 justify-start overflow-hidden md:col-start-2 md:justify-center">
            {center}
          </div>

          <div className="hidden shrink-0 items-center justify-self-end md:col-start-3 md:flex">
            {search}
          </div>
        </div>
      ) : (
        <div className="flex w-full min-w-0 items-center gap-2 px-4">
          {leading}
          <div className="ml-auto flex w-auto shrink-0 items-center gap-2">
            {search}
          </div>
        </div>
      )}
    </header>
  );
}
