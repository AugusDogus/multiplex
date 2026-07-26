import { MediaItemDetailsRoute } from "~/components/media-item-details-route";

export const prefetch = "allow-runtime";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    ratingKey: string;
  }>;
}

export default function MediaDetailsPage({ params }: PageProps) {
  return <MediaItemDetailsRoute params={params} itemType="media" />;
}
