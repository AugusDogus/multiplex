import { MediaItemDetailsRoute } from "~/components/media-item-details-route";

export const prefetch = "allow-runtime";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    ratingKey: string;
  }>;
}

export default function EpisodeDetailsPage({ params }: PageProps) {
  return <MediaItemDetailsRoute params={params} itemType="episode" />;
}
