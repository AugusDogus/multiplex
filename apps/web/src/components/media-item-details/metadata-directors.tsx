import { formatDirectorList, type ItemMetadata } from "@multiplex/plex-query";

interface MetadataDirectorsProps {
  item: Pick<ItemMetadata, "Director">;
}

export function MetadataDirectors({ item }: MetadataDirectorsProps) {
  const directors = formatDirectorList(item.Director);
  if (!directors) {
    return null;
  }

  return (
    <p className="text-foreground/70 text-sm sm:text-base">
      Directed by {directors}
    </p>
  );
}
