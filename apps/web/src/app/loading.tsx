import { Skeleton } from "~/components/ui/skeleton";

/**
 * Root loading boundary. With `cacheComponents` enabled, every page must
 * resolve its dynamic data (auth session, Plex requests) inside a Suspense
 * boundary; this app-shell skeleton (sidebar rail, header, content rows)
 * provides one for all routes.
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen">
      {/* Sidebar rail (desktop only) */}
      <div className="bg-sidebar hidden w-[16rem] shrink-0 flex-col gap-2 p-4 md:flex">
        <Skeleton className="mb-4 h-8 w-32" />
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>

      <div className="min-w-0 flex-1">
        {/* Header */}
        <div className="flex h-16 items-center gap-2 px-4">
          <Skeleton className="hidden size-7 md:block" />
          <Skeleton className="h-6 w-28" />
          <Skeleton className="ml-auto h-9 w-full max-w-xs rounded-md" />
        </div>

        {/* Content rows */}
        <div className="flex flex-col gap-10 p-4">
          <section className="flex flex-col gap-4">
            <Skeleton className="h-8 w-56 md:mx-4" />
            <div className="flex gap-4 overflow-hidden md:px-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex shrink-0 flex-col gap-2">
                  <Skeleton className="h-[240px] w-[160px] rounded-md" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <Skeleton className="h-8 w-64 md:mx-4" />
            <div className="flex gap-4 overflow-hidden md:px-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton
                  key={i}
                  className="h-[240px] w-[160px] shrink-0 rounded-md"
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
