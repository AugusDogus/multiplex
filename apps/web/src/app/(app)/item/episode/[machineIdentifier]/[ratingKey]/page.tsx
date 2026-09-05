import { MediaItemDetailsRoute } from "~/components/media-item-details-route";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    ratingKey: string;
  }>;
}

export default function EpisodeDetailsPage({ params }: PageProps) {
  return <MediaItemDetailsRoute params={params} itemType="episode" />;
}
