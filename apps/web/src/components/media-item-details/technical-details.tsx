import { getTechnicalRows, type ItemMetadata } from "@multiplex/plex-query";
import {
  Captions as CaptionsIcon,
  Film as FilmIcon,
  Volume2 as VolumeIcon,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

import { DetailsSection } from "./details-section";

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
    <DetailsSection title="Media Info">
      <div className="grid gap-3 sm:grid-cols-3">
        {rows.map((row) => {
          const Icon = ROW_ICONS[row.label] ?? FilmIcon;

          return (
            <div
              key={row.label}
              className="bg-card ring-border/60 flex items-start gap-3 rounded-xl p-4 text-sm ring-1"
            >
              <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
                <Icon className="text-foreground/70 size-4" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                  {row.label}
                </span>
                <span className="text-foreground font-medium">{row.value}</span>
              </div>
            </div>
          );
        })}
      </div>
    </DetailsSection>
  );
}
