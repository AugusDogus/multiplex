import { AppHeaderSkeleton } from "~/components/app-header-skeleton";
import { AppPageContent } from "~/components/app-page-content";
import { LibraryPivotContentSkeleton } from "~/components/library-pivot-content-skeleton";

export default function MediaLibraryLoading() {
  return (
    <>
      <AppHeaderSkeleton center mobile />
      <AppPageContent>
        <LibraryPivotContentSkeleton />
      </AppPageContent>
    </>
  );
}
