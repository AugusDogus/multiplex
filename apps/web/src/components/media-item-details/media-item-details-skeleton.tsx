import { Skeleton } from "~/components/ui/skeleton";

function DetailsHeroSkeleton() {
  return (
    <>
      <section className="relative hidden rounded-2xl lg:block">
        <Skeleton className="absolute inset-0 -z-10 rounded-2xl" />
        <div className="flex flex-col gap-6 p-4 sm:p-6 lg:flex-row lg:p-8">
          <div className="flex w-full flex-col gap-3 sm:w-[220px] lg:shrink-0">
            <Skeleton className="aspect-2/3 w-full rounded-xl" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-5 lg:max-w-3xl">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-28 rounded-full" />
              </div>
              <Skeleton className="h-10 w-3/4 max-w-lg sm:h-12" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-10 w-32 rounded-md" />
              <Skeleton className="size-9 rounded-md" />
              <Skeleton className="size-9 rounded-md" />
              <Skeleton className="size-9 rounded-md" />
            </div>
          </div>
        </div>
      </section>

      <section className="relative -mx-4 overflow-hidden lg:hidden">
        <Skeleton className="absolute inset-0 -z-10" />
        <div className="relative grid grid-cols-[108px_minmax(0,1fr)] gap-x-4 gap-y-4 px-4 py-5">
          <div className="flex flex-col gap-2 self-start">
            <Skeleton className="aspect-2/3 w-[108px] rounded-lg" />
          </div>
          <div className="flex min-w-0 flex-col justify-center gap-2 self-center">
            <Skeleton className="h-7 w-full" />
          </div>
          <div className="col-span-2 flex gap-2">
            <Skeleton className="h-10 min-h-11 flex-1 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
            <Skeleton className="size-9 rounded-md" />
          </div>
        </div>
      </section>
    </>
  );
}

function DetailsSynopsisSkeleton() {
  return (
    <section className="bg-card ring-border/60 rounded-2xl p-5 shadow-sm ring-1">
      <Skeleton className="mb-3 h-5 w-16" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </section>
  );
}

function TechnicalDetailsSkeleton() {
  return (
    <section className="bg-card grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1">
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </section>
  );
}

function CastGridSkeleton() {
  return (
    <section className="flex flex-col gap-4">
      <Skeleton className="h-8 w-40" />
      <div className="scrollbar-hide -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex w-32 shrink-0 flex-col items-center gap-3 text-center"
          >
            <Skeleton className="size-20 rounded-full" />
            <div className="flex min-h-20 w-full flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MediaItemDetailsSkeleton() {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 pb-24 lg:gap-8 lg:pb-8">
      <DetailsHeroSkeleton />
      <div className="lg:hidden">
        <DetailsSynopsisSkeleton />
      </div>
      <TechnicalDetailsSkeleton />
      <CastGridSkeleton />
    </div>
  );
}
