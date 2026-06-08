import { getTechnicalRows, type ItemMetadata } from "@multiplex/plex-query";
import {
  Captions as CaptionsIcon,
  Film as FilmIcon,
  Volume2 as VolumeIcon,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

interface TechnicalDetailsProps {
  item: ItemMetadata;
}

const ROW_ICONS: Record<string, LucideIcon> = {
  Video: FilmIcon,
  Audio: VolumeIcon,
  Subtitles: CaptionsIcon,
};

export function TechnicalDetails({ item }: TechnicalDetailsProps) {
  const rows = getTechnicalRows(item).filter((row) => row.value);
  if (rows.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
        Media Info
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {rows.map((row) => {
          const Icon = ROW_ICONS[row.label] ?? FilmIcon;

          return (
            <div
              key={row.label}
              className="bg-card flex items-start gap-3 rounded-xl border p-4 text-sm"
            >
              <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {row.label}
                </span>
                <span className="font-medium">{row.value}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
