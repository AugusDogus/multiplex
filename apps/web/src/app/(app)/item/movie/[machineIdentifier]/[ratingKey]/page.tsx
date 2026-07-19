import { MediaItemDetailsRoute } from "~/components/media-item-details-route";

export const prefetch = "allow-runtime";

interface PageProps {
  params: Promise<{
    machineIdentifier: string;
    ratingKey: string;
  }>;
}

export default function MovieDetailsPage({ params }: PageProps) {
  return <MediaItemDetailsRoute params={params} itemType="movie" />;
}
