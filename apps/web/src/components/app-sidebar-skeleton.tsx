import { Skeleton } from "~/components/ui/skeleton";

export function AppSidebarSkeleton() {
  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-state="expanded"
      data-variant="inset"
      data-slot="sidebar"
    >
      <div
        data-slot="sidebar-gap"
        className="relative w-(--sidebar-width) bg-transparent"
      />
      <div
        data-slot="sidebar-container"
        className="fixed inset-y-0 left-0 z-10 hidden h-svh w-(--sidebar-width) p-2 md:flex"
      >
        <div className="bg-sidebar flex h-full w-full flex-col gap-2 p-4">
          <Skeleton className="mb-4 h-8 w-32" />
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
