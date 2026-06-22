import { getTechnicalRows, type ItemMetadata } from "@multiplex/plex-query";

interface TechnicalDetailsProps {
  item: ItemMetadata;
}

export function TechnicalDetails({ item }: TechnicalDetailsProps) {
  const rows = getTechnicalRows(item);
  if (rows.length === 0) {
    return null;
  }

  return (
    <section
      id="technical-details"
      className="bg-card grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-3"
    >
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1">
          <span className="text-muted-foreground">{row.label}</span>
          <span className="font-medium">{row.value}</span>
        </div>
      ))}
    </section>
  );
}
