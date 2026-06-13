import { AppHeaderSkeleton } from "~/components/app-header-skeleton";
import { AppPageContent } from "~/components/app-page-content";
import { LibraryBrowseSkeleton } from "~/components/library-browse-skeleton";

export default function MediaLibraryLoading() {
  return (
    <>
      <AppHeaderSkeleton />
      <AppPageContent>
        <LibraryBrowseSkeleton />
      </AppPageContent>
    </>
  );
}
