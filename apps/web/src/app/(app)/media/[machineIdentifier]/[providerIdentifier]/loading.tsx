import { Suspense } from "react";

import { AppHeaderSkeleton } from "~/components/app-header-skeleton";
import { AppPageContent } from "~/components/app-page-content";
import { LibraryBrowseSkeleton } from "~/components/library-browse-skeleton";
import { LibraryPivotContentSkeleton } from "~/components/library-pivot-content-skeleton";

export default function MediaLibraryLoading() {
  return (
    <>
      <AppHeaderSkeleton center mobile />
      <AppPageContent>
        <Suspense fallback={<LibraryBrowseSkeleton />}>
          <LibraryPivotContentSkeleton />
        </Suspense>
      </AppPageContent>
    </>
  );
}
