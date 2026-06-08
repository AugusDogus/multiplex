import { type ItemMetadata } from "@multiplex/plex-query";

import { Badge } from "~/components/ui/badge";

interface MetadataGenresProps {
  item: Pick<ItemMetadata, "Genre">;
}

export function MetadataGenres({ item }: MetadataGenresProps) {
  const genres = item.Genre;
  if (!genres?.length) {
    return null;
  }

  return (
    <div className="scrollbar-hide -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-0.5">
      {genres.map((genre) => (
        <Badge
          key={genre.tag}
          variant="secondary"
          className="shrink-0 text-xs font-normal"
        >
          {genre.tag}
        </Badge>
      ))}
    </div>
  );
}
