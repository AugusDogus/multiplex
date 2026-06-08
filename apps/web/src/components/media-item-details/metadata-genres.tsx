import { formatGenreSummary, type ItemMetadata } from "@multiplex/plex-query";

import { Badge } from "~/components/ui/badge";

interface MetadataGenresProps {
  item: Pick<ItemMetadata, "Genre">;
}

export function MetadataGenres({ item }: MetadataGenresProps) {
  const genres = item.Genre;
  const summary = formatGenreSummary(genres);

  if (!genres?.length) {
    return null;
  }

  return (
    <>
      {summary && (
        <p className="text-muted-foreground hidden text-sm lg:block">
          {summary}
        </p>
      )}
      <div className="scrollbar-hide -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-0.5 lg:hidden">
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
    </>
  );
}
