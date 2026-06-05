"use client";

import type {
  ItemMetadata,
  StreamType as PlexStream,
} from "@multiplex/plex-query";
import { Check, ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import { api } from "~/trpc/react";
import type { MediaPlayerItem, PlaybackRate } from "~/types/media-player";
import {
  buildPlexSubtitleSelectionUrl,
  playbackUsesTranscode,
} from "./utils/plex-stream-utils";

/* ────────────────────────────────────────────────────────────
   Media Player Settings Menu
   Popover with internal pane navigation (root → speed → subtitles)
   ──────────────────────────────────────────────────────────── */

const PLAYBACK_RATE_OPTIONS: Array<{ label: string; value: PlaybackRate }> = [
  { label: ".5x", value: 0.5 },
  { label: ".75x", value: 0.75 },
  { label: "Normal", value: 1 },
  { label: "1.25x", value: 1.25 },
  { label: "1.5x", value: 1.5 },
  { label: "1.75x", value: 1.75 },
  { label: "2x", value: 2 },
];

type SubtitleStream = Extract<PlexStream, { streamType: 3 }>;
type Pane = "root" | "speed" | "subtitles";

/**
 * Either the shallow item from the continue-watching hub or the fully
 * expanded metadata fetched on demand. Both expose the same `Media[]`
 * shape, but only the latter reliably contains `Part[].Stream[]`.
 */
type StreamSource = MediaPlayerItem | ItemMetadata | null | undefined;

interface MediaPlayerSettingsMenuProps {
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function MediaPlayerSettingsMenu({
  disabled,
  onOpenChange,
}: MediaPlayerSettingsMenuProps) {
  const currentItem = useMediaPlayerStore((state) => state.currentItem);
  const playbackRate = useMediaPlayerStore((state) => state.playbackRate);
  const currentTime = useMediaPlayerStore((state) => state.currentTime);
  const autoPlayEnabled = useMediaPlayerStore(
    (state) => state.autoPlay.isEnabled,
  );
  const { setAutoPlayEnabled, setPlaybackRate, applyPlaybackMetadata } =
    useMediaPlayerStore();

  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("root");
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [isUpdatingSubtitle, setIsUpdatingSubtitle] = useState(false);

  // Always start on the root pane the next time the menu opens.
  useEffect(() => {
    if (!open) setPane("root");
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };

  // `hubs/continueWatching` does not expand `Media[].Part[].Stream[]`, so the
  // shallow `currentItem` from the store has no audio or subtitle stream
  // information. Fetch the full metadata once the player has an item so the
  // settings menu can show real stream choices.
  const { data: detailedItem, refetch: refetchDetailedItem } =
    api.plex.getItemMetadata.useQuery(
      {
        serverId: currentItem?.serverId ?? "",
        ratingKey: currentItem?.ratingKey ?? "",
      },
      {
        enabled: Boolean(currentItem?.serverId && currentItem.ratingKey),
        staleTime: 5 * 60 * 1000,
      },
    );

  // Keep the store's `currentItem` hydrated with expanded stream metadata so
  // playback and the settings menu share one canonical subtitle selection.
  // Read `currentItem` inside the effect so hydrating the store does not
  // retrigger this effect and cause an update loop.
  useEffect(() => {
    if (!detailedItem) return;
    const item = useMediaPlayerStore.getState().currentItem;
    if (!item || item.ratingKey !== detailedItem.ratingKey) return;
    applyPlaybackMetadata(detailedItem);
  }, [detailedItem, applyPlaybackMetadata]);

  const streamSource: StreamSource = detailedItem ?? currentItem;
  const qualityLabel = getQualityLabel(streamSource);
  const audioLabel = getAudioStreamLabel(streamSource);
  const subtitleStreams = getSubtitleStreams(streamSource);
  const hasSubtitles = subtitleStreams.length > 0;
  const selectedSubtitleStream = subtitleStreams.find(
    (stream) => stream.selected,
  );
  const selectedSubtitleStreamId = selectedSubtitleStream?.id ?? null;
  const subtitleLabel = hasSubtitles
    ? selectedSubtitleStream
      ? getStreamLabel(selectedSubtitleStream, "Subtitle")
      : "None"
    : "Unavailable";

  const handleSubtitleSelection = async (streamId: number | null) => {
    if (!currentItem) {
      return;
    }

    if (streamId === selectedSubtitleStreamId) {
      setPane("root");
      return;
    }

    setIsUpdatingSubtitle(true);
    setSubtitleError(null);

    try {
      const selectionUrl = buildPlexSubtitleSelectionUrl(
        currentItem,
        currentItem.serverUrl,
        currentItem.authToken,
        streamId,
      );
      const response = await fetch(selectionUrl, { method: "PUT" });

      if (!response.ok) {
        throw new Error(`Plex returned ${response.status}`);
      }

      const previousUsesTranscode = playbackUsesTranscode(currentItem);
      const refreshed = await refetchDetailedItem();
      if (refreshed.data) {
        applyPlaybackMetadata(refreshed.data, {
          preserveCurrentTime: currentTime,
          reloadVideo: true,
          previousVideoUsesTranscode: previousUsesTranscode,
        });
      }
      setPane("root");
    } catch (error) {
      console.error(
        "Failed to select subtitle stream:",
        error instanceof Error ? error.message : error,
      );
      setSubtitleError("Unable to update subtitles");
    } finally {
      setIsUpdatingSubtitle(false);
    }
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-white hover:bg-white/20"
          disabled={disabled}
          aria-label="Playback settings"
        >
          <Settings className="h-5 w-5" />
        </Button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="end"
          sideOffset={12}
          className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50 w-72 overflow-hidden rounded-lg border border-white/10 bg-black/90 p-1.5 text-white backdrop-blur-md"
        >
          {pane === "root" ? (
            <div className="flex flex-col">
              <ReadOnlyRow label="Quality" value={qualityLabel} />
              <NavRow
                label="Playback Speed"
                value={formatPlaybackRate(playbackRate)}
                onClick={() => setPane("speed")}
              />
              <ReadOnlyRow label="Audio Stream" value={audioLabel} />
              <NavRow
                label="Subtitles"
                value={subtitleLabel}
                onClick={() => setPane("subtitles")}
                disabled={!hasSubtitles || isUpdatingSubtitle}
              />

              <Separator />

              <ToggleRow
                label="Auto Play"
                checked={autoPlayEnabled}
                onChange={setAutoPlayEnabled}
              />
            </div>
          ) : pane === "speed" ? (
            <Pane title="Playback Speed" onBack={() => setPane("root")}>
              {PLAYBACK_RATE_OPTIONS.map((option) => (
                <SelectRow
                  key={option.value}
                  label={option.label}
                  selected={option.value === playbackRate}
                  onClick={() => {
                    setPlaybackRate(option.value);
                    setPane("root");
                  }}
                />
              ))}
            </Pane>
          ) : (
            <Pane title="Subtitles" onBack={() => setPane("root")}>
              <SelectRow
                label="None"
                selected={selectedSubtitleStreamId === null}
                onClick={() => void handleSubtitleSelection(null)}
                disabled={isUpdatingSubtitle}
              />
              {subtitleStreams.map((stream) => (
                <SelectRow
                  key={stream.id}
                  label={getStreamLabel(stream, "Subtitle")}
                  selected={stream.id === selectedSubtitleStreamId}
                  onClick={() => void handleSubtitleSelection(stream.id)}
                  disabled={isUpdatingSubtitle}
                />
              ))}
              {subtitleError && (
                <p className="px-3 py-2 text-xs text-red-300">
                  {subtitleError}
                </p>
              )}
            </Pane>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/* ────────────────────────────────────────────────────────────
   Row primitives
   ──────────────────────────────────────────────────────────── */

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md px-3 py-2 text-sm">
      <span>{label}</span>
      <span className="ml-auto truncate text-xs text-white/60">{value}</span>
    </div>
  );
}

function NavRow({
  label,
  value,
  onClick,
  disabled = false,
}: {
  label: string;
  value: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-white/35"
          : "text-white hover:bg-white/10",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "ml-auto truncate text-xs",
          disabled ? "text-white/35" : "text-white/60",
        )}
      >
        {value}
      </span>
      <ChevronRight
        className={cn("h-4 w-4", disabled ? "text-white/35" : "text-white/60")}
        aria-hidden="true"
      />
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-white transition-colors hover:bg-white/10"
    >
      <span>{label}</span>
      <span
        className={cn(
          "ml-auto inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-white" : "bg-white/25",
        )}
      >
        <span
          className={cn(
            "h-4 w-4 rounded-full bg-black transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}

function Separator() {
  return <div className="my-1 h-px bg-white/10" />;
}

function Pane({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
      >
        <ChevronLeft className="h-4 w-4 text-white/60" aria-hidden="true" />
        <span>{title}</span>
      </button>
      <Separator />
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function SelectRow({
  label,
  selected,
  onClick,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        disabled
          ? "cursor-not-allowed text-white/35"
          : "text-white hover:bg-white/10",
      )}
    >
      <Check
        className={cn("h-4 w-4", selected ? "text-white" : "text-transparent")}
        aria-hidden="true"
      />
      <span>{label}</span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────────
   Label helpers
   ──────────────────────────────────────────────────────────── */

function getQualityLabel(item: StreamSource): string {
  const media = item?.Media?.[0];
  if (!media) return "Original";

  const details = [
    formatBitrate(media.bitrate),
    formatResolution(media.height, media.videoResolution),
  ].filter((value): value is string => Boolean(value));

  if (details.length === 0) return "Original";
  return `Original (${details.join(", ")})`;
}

function formatBitrate(bitrate?: number): string | null {
  if (!bitrate) return null;

  if (bitrate >= 1000) {
    return `${(bitrate / 1000).toFixed(1)} Mbps`;
  }

  return `${bitrate} Kbps`;
}

function formatResolution(
  height?: number,
  videoResolution?: string,
): string | null {
  const resolution = height ?? Number(videoResolution);
  if (!Number.isFinite(resolution) || resolution <= 0) return null;

  if (resolution >= 720) {
    return `${resolution}p HD`;
  }

  return `${resolution}p`;
}

function getAudioStreamLabel(item: StreamSource): string {
  const streams = item?.Media?.[0]?.Part?.[0]?.Stream ?? [];
  const audioStream =
    streams.find((stream) => stream.streamType === 2 && stream.selected) ??
    streams.find((stream) => stream.streamType === 2 && stream.default) ??
    streams.find((stream) => stream.streamType === 2);

  if (!audioStream) {
    const media = item?.Media?.[0];
    if (!media?.audioCodec) return "Unavailable";
    return media.audioCodec.toUpperCase();
  }

  return getStreamLabel(audioStream, "Audio");
}

function getSubtitleStreams(item: StreamSource): SubtitleStream[] {
  const streams = item?.Media?.[0]?.Part?.[0]?.Stream ?? [];
  return streams.filter(
    (stream): stream is SubtitleStream => stream.streamType === 3,
  );
}

function getStreamLabel(stream: PlexStream, fallback: string): string {
  const displayTitle = stream.displayTitle ?? stream.language ?? fallback;
  const extendedTitle = stream.extendedDisplayTitle;

  if (!extendedTitle || extendedTitle === displayTitle) {
    return displayTitle;
  }

  if (extendedTitle.startsWith(displayTitle)) {
    const detail = extendedTitle
      .slice(displayTitle.length)
      .replace(/[()]/g, "")
      .trim();

    return detail ? `${displayTitle}, ${detail}` : displayTitle;
  }

  return extendedTitle;
}

function formatPlaybackRate(playbackRate: PlaybackRate): string {
  return (
    PLAYBACK_RATE_OPTIONS.find((option) => option.value === playbackRate)
      ?.label ?? "Normal"
  );
}
