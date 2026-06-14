import { MediaHubRowSkeleton } from "~/components/media-hub-row";

export function LibraryBrowseSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <MediaHubRowSkeleton />
      <MediaHubRowSkeleton />
    </div>
  );
}
