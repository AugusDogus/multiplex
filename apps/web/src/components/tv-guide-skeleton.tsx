import { Skeleton } from "~/components/ui/skeleton";

const CHANNEL_COUNT = 8;
const TIME_SLOT_COUNT = 8;

export function TvGuideSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="bg-card text-card-foreground w-full overflow-hidden rounded-xl border shadow-sm"
    >
      <div className="flex">
        <div className="bg-muted/20 flex w-20 shrink-0 flex-col border-r md:w-48">
          <div className="flex h-8 items-center justify-center">
            <Skeleton className="h-3 w-10" />
          </div>
          {Array.from({ length: CHANNEL_COUNT }).map((_, index) => (
            <div
              key={index}
              className="flex min-h-16 items-center gap-3 border-t p-2"
            >
              <Skeleton className="size-10 shrink-0 rounded" />
              <div className="hidden min-w-0 flex-1 flex-col gap-1.5 md:flex">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex h-8 border-b">
            {Array.from({ length: TIME_SLOT_COUNT }).map((_, index) => (
              <div
                key={index}
                className="flex flex-1 items-center justify-center border-l first:border-l-0"
              >
                <Skeleton className="h-3 w-12" />
              </div>
            ))}
          </div>

          {Array.from({ length: CHANNEL_COUNT }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className="relative flex min-h-16 items-stretch border-t"
            >
              <div className="absolute inset-0.5 flex gap-1">
                <Skeleton className="h-full w-[28%] rounded" />
                <Skeleton className="h-full w-[22%] rounded" />
                <Skeleton className="h-full flex-1 rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
