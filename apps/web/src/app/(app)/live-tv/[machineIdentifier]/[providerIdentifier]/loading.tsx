import { AppHeaderSkeleton } from "~/components/app-header-skeleton";
import { AppPageContent } from "~/components/app-page-content";
import { TvGuideSkeleton } from "~/components/tv-guide-skeleton";

export default function LiveTvLoading() {
  return (
    <>
      <AppHeaderSkeleton mobile />
      <AppPageContent>
        <TvGuideSkeleton />
      </AppPageContent>
    </>
  );
}
