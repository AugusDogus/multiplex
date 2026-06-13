import { Skeleton } from "~/components/ui/skeleton";

const continueWatchingItems = [
  {
    frame: "poster",
    title: "w-36",
    subtitles: ["w-24"],
  },
  {
    frame: "episode",
    title: "w-28",
    subtitles: ["w-32", "w-20"],
  },
  {
    frame: "poster",
    title: "w-24",
    subtitles: ["w-16"],
  },
  {
    frame: "episode",
    title: "w-40",
    subtitles: ["w-28", "w-24"],
  },
  {
    frame: "poster",
    title: "w-32",
    subtitles: ["w-28"],
  },
  {
    frame: "episode",
    title: "w-20",
    subtitles: ["w-36", "w-16"],
  },
  {
    frame: "poster",
    title: "w-40",
    subtitles: ["w-20"],
  },
  {
    frame: "episode",
    title: "w-28",
    subtitles: ["w-24", "w-20"],
  },
] as const;

function ContinueWatchingCardSkeleton({
  item,
}: {
  item: (typeof continueWatchingItems)[number];
}) {
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="relative h-[240px] w-[160px] overflow-hidden rounded-md shadow-lg">
        <Skeleton className="absolute inset-0 rounded-md" />
        {item.frame === "episode" && (
          <Skeleton className="absolute top-12 left-0 h-[90px] w-full rounded-none" />
        )}
      </div>
      <div className="flex w-[160px] flex-col gap-1">
        <Skeleton className={`h-4 ${item.title}`} />
        {item.subtitles.map((width, index) => (
          <Skeleton key={`${width}-${index}`} className={`h-3 ${width}`} />
        ))}
      </div>
    </div>
  );
}

export function HomeContentSkeleton() {
  return (
    <>
      <section className="flex flex-col gap-4">
        <div className="px-4 md:px-8">
          <Skeleton className="h-8 w-56" />
        </div>
        <div className="flex gap-4 overflow-hidden px-4 pb-4 md:px-8">
          {continueWatchingItems.map((item, i) => (
            <ContinueWatchingCardSkeleton key={i} item={item} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="px-4 md:px-8">
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="flex gap-4 overflow-hidden px-4 pb-4 md:px-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-[240px] w-[160px] shrink-0 rounded-md"
            />
          ))}
        </div>
      </section>
    </>
  );
}
