import { Star } from "lucide-react";
import { getRatingLabel, type ItemMetadata } from "@multiplex/plex-query";

interface MetadataRatingProps {
  item: ItemMetadata;
}

export function MetadataRating({ item }: MetadataRatingProps) {
  const ratingLabel = getRatingLabel(item);
  if (!ratingLabel) {
    return null;
  }

  return (
    <div className="flex items-center justify-center gap-2 text-sm sm:justify-start">
      <Star className="fill-primary text-primary size-4" />
      <span>{ratingLabel}</span>
    </div>
  );
}
