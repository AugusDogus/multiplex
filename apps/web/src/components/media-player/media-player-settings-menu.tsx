"use client";

import type {
  ItemMetadata,
  StreamType as PlexStream,
} from "@multiplex/plex-query";
import { Check, ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import {
  playerCommands,
  usePlayerStateSelector,
} from "~/lib/effect/player-atoms";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import { shallow } from "zustand/shallow";
import { api } from "~/trpc/api";
import type { MediaPlayerItem, PlaybackRate } from "~/types/media-player";
import { CAPTION_SIZE_OPTIONS } from "./utils/caption-size";
import { playbackUsesTranscode } from "./utils/plex-playback-plan";
import { buildPlexSubtitleSelectionUrl } from "./utils/plex-stream-urls";

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
  /**
   * Hide the Playback Speed control. In a Watch Together session an unsynced
   * local rate would only desync viewers, so speed selection is unavailable.
   */
  isWatchTogetherActive?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function MediaPlayerSettingsMenu({
  disabled,
  isWatchTogetherActive = false,
  onOpenChange,
}: MediaPlayerSettingsMenuProps) {
  const { currentItem, streamSessionId } = usePlayerStateSelector(
    (state) => ({
      currentItem: state.currentItem,
      streamSessionId: state.streamSessionId,
    }),
    shallow,
  );
  const playbackRate = usePlayerPrefsStore((state) => state.playbackRate);
  const captionSize = usePlayerPrefsStore((state) => state.captionSize);
  const autoPlayEnabled = usePlayerPrefsStore((state) => state.autoPlayEnabled);
  const setAutoPlayEnabled = usePlayerPrefsStore(
    (state) => state.setAutoPlayEnabled,
  );
  const setPlaybackRate = usePlayerPrefsStore((state) => state.setPlaybackRate);
  const setCaptionSize = usePlayerPrefsStore((state) => state.setCaptionSize);
  const applyPlaybackMetadata = playerCommands.applyPlaybackMetadata;

  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("root");
  const [subtitleError, setSubtitleError] = useState<string | null>(null);
  const [isUpdatingSubtitle, setIsUpdatingSubtitle] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setPane("root");
    }
    setOpen(next);
    onOpenChange?.(next);
  };

  // `hubs/continueWatching` does not expand `Media[].Part[].Stream[]`, so the
  // shallow `currentItem` from the store has no audio or subtitle stream
  // information. Fetch the full metadata once the player has an item so the
  // settings menu can show real stream choices.
  const metadataServerId = currentItem?.serverId ?? "";
  const metadataRatingKey = currentItem?.ratingKey ?? "";
  const { data: detailedItem, refetch: refetchDetailedItem } =
    api.plex.getItemMetadata.useQuery(
      {
        serverId: metadataServerId,
        ratingKey: metadataRatingKey,
      },
      {
        enabled: Boolean(metadataServerId && metadataRatingKey),
        staleTime: 5 * 60 * 1000,
      },
    );

  // Keep the store's `currentItem` hydrated with expanded stream metadata so
  // playback and the settings menu share one canonical subtitle selection.
  useEffect(() => {
    if (
      !detailedItem ||
      !metadataServerId ||
      !metadataRatingKey ||
      detailedItem.ratingKey !== metadataRatingKey
    ) {
      return;
    }

    const identity = {
      streamSessionId,
      serverId: metadataServerId,
      ratingKey: metadataRatingKey,
    };
    const currentIdentity = playerCommands.playbackIdentity();
    if (
      currentIdentity?.streamSessionId !== identity.streamSessionId ||
      currentIdentity.serverId !== identity.serverId ||
      currentIdentity.ratingKey !== identity.ratingKey
    ) {
      return;
    }
    applyPlaybackMetadata(identity, detailedItem);
  }, [
    detailedItem,
    metadataServerId,
    metadataRatingKey,
    streamSessionId,
    applyPlaybackMetadata,
    currentItem,
  ]);

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

    const playbackIdentity = playerCommands.playbackIdentity();
    if (
      playbackIdentity?.serverId !== currentItem.serverId ||
      playbackIdentity.ratingKey !== currentItem.ratingKey
    ) {
      return;
    }

    const isCurrentPlayback = () => {
      const currentIdentity = playerCommands.playbackIdentity();
      return (
        currentIdentity?.streamSessionId === playbackIdentity.streamSessionId &&
        currentIdentity.serverId === playbackIdentity.serverId &&
        currentIdentity.ratingKey === playbackIdentity.ratingKey
      );
    };

    if (streamId === selectedSubtitleStreamId) {
      setPane("root");
      return;
    }

    setIsUpdatingSubtitle(true);
    setSubtitleError(null);

    const selectionUrl = buildPlexSubtitleSelectionUrl(
      currentItem,
      currentItem.serverUrl,
      currentItem.authToken,
      streamId,
    );
    const previousUsesTranscode = playbackUsesTranscode(currentItem);

    await fetch(selectionUrl, { method: "PUT" })
      .then(async (response) => {
        if (!response.ok) {
          console.error(
            `Failed to select subtitle stream: Plex returned ${response.status}`,
          );
          if (isCurrentPlayback()) {
            setSubtitleError("Unable to update subtitles");
          }
          return;
        }

        if (!isCurrentPlayback()) {
          return;
        }
        const refreshed = await refetchDetailedItem();
        if (!isCurrentPlayback()) {
          return;
        }
        if (refreshed.data) {
          applyPlaybackMetadata(playbackIdentity, refreshed.data, {
            reloadVideo: true,
            previousVideoUsesTranscode: previousUsesTranscode,
          });
        }
        setPane("root");
      })
      .catch((cause: unknown) => {
        console.error("Failed to select subtitle stream:", cause);
        if (isCurrentPlayback()) {
          setSubtitleError("Unable to update subtitles");
        }
      })
      .finally(() => {
        setIsUpdatingSubtitle(false);
      });
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
            disabled={disabled}
            aria-label="Playback settings"
          />
        }
      >
        <Settings className="h-5 w-5" />
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={12}
        className="w-72 overflow-hidden border-white/10 bg-black/90 text-white backdrop-blur-md [&>[data-slot=popover-viewport]]:p-1.5"
      >
        {pane === "root" ? (
          <div className="flex flex-col">
            <ReadOnlyRow label="Quality" value={qualityLabel} />
            {!isWatchTogetherActive && (
              <NavRow
                label="Playback Speed"
                value={formatPlaybackRate(playbackRate)}
                onClick={() => setPane("speed")}
              />
            )}
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
              <p className="px-3 py-2 text-xs text-red-300">{subtitleError}</p>
            )}
            <Separator />
            <p className="px-3 py-1 text-xs text-white/50">Subtitle Size</p>
            {CAPTION_SIZE_OPTIONS.map((option) => (
              <SelectRow
                key={option.value}
                label={option.label}
                selected={option.value === captionSize}
                onClick={() => setCaptionSize(option.value)}
              />
            ))}
          </Pane>
        )}
      </PopoverContent>
    </Popover>
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
