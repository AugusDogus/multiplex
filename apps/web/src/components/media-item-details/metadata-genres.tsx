import { formatGenreSummary, type ItemMetadata } from "@multiplex/plex-query";

interface MetadataGenresProps {
  item: Pick<ItemMetadata, "Genre">;
}

export function MetadataGenres({ item }: MetadataGenresProps) {
  const summary = formatGenreSummary(item.Genre);
  if (!summary) {
    return null;
  }

  return <p className="text-muted-foreground text-sm">{summary}</p>;
}
