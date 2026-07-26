"use client";

import { ExternalLink, FileVideo } from "lucide-react";
import { getMediaInfo, type MediaInfoRow } from "@multiplex/plex-query";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "~/components/ui/dialog";

import type { ItemDetails } from "./types";

interface MediaInfoDialogProps {
  item: ItemDetails["item"];
  serverUrl: string | undefined;
  authToken: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MediaInfoDialog({
  item,
  serverUrl,
  authToken,
  open,
  onOpenChange,
}: MediaInfoDialogProps) {
  const versions = getMediaInfo(item);
  const xmlUrl = buildViewXmlUrl(item.ratingKey, serverUrl, authToken);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-6 pb-4">
          <DialogTitle>Media Info</DialogTitle>
          <DialogDescription className="line-clamp-1">
            {item.title}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="py-4">
          {versions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No media information is available for this item.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {versions.map((version) => (
                <section key={version.id} className="flex flex-col gap-3">
                  <h3 className="text-sm font-semibold">{version.label}</h3>
                  <InfoRows rows={version.rows} />

                  {version.parts.map((part) => (
                    <div key={part.id} className="flex flex-col gap-3">
                      {part.file && (
                        <div className="flex items-start gap-2 text-sm">
                          <FileVideo className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                          <span className="text-muted-foreground break-all">
                            {part.file}
                          </span>
                        </div>
                      )}
                      <InfoRows rows={part.rows} />

                      {part.streams.map((stream) => (
                        <div
                          key={`${stream.kind}-${stream.id}`}
                          className="bg-card flex flex-col gap-2 rounded-lg border p-3"
                        >
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{stream.kind}</Badge>
                            <span className="text-sm font-medium">
                              {stream.title}
                            </span>
                          </div>
                          <InfoRows rows={stream.rows} />
                        </div>
                      ))}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </DialogPanel>

        {xmlUrl && (
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              render={<a href={xmlUrl} target="_blank" rel="noreferrer" />}
            >
              <ExternalLink data-icon="inline-start" />
              View XML
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function InfoRows({ rows }: { rows: MediaInfoRow[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col">
          <dt className="text-muted-foreground text-xs">{row.label}</dt>
          <dd className="font-medium break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function buildViewXmlUrl(
  ratingKey: string,
  serverUrl: string | undefined,
  authToken: string | undefined,
): string | undefined {
  if (!serverUrl || !authToken) {
    return undefined;
  }

  const base = serverUrl.endsWith("/") ? serverUrl.slice(0, -1) : serverUrl;
  const params = new URLSearchParams({
    includeChapters: "1",
    includeMarkers: "1",
    "X-Plex-Token": authToken,
  });

  return `${base}/library/metadata/${ratingKey}?${params.toString()}`;
}
