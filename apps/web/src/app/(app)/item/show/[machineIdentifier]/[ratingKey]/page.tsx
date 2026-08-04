import { MediaItemDetailsRoute } from "~/components/media-item-details-route";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    ratingKey: string;
  }>;
}

export default function ShowDetailsPage({ params }: PageProps) {
  return <MediaItemDetailsRoute params={params} itemType="show" />;
}
