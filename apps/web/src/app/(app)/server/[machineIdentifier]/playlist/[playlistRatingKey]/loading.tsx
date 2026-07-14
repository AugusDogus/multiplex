import { Skeleton } from "~/components/ui/skeleton";

export default function PlaylistLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <Skeleton className="h-36 w-full rounded-xl" />
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}
