"use client";
import { Check, ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import type { PlaybackRate } from "~/types/media-player";
import { CAPTION_SIZE_OPTIONS } from "./utils/caption-size";
import { getStreamLabel } from "./utils/playback-stream-info";
import { usePlaybackStreams } from "./use-playback-streams";

/* ────────────────────────────────────────────────────────────
   Media Player Settings Menu
   Popover with internal pane navigation (root → speed → audio → subtitles)
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

type Pane = "root" | "speed" | "audio" | "subtitles";

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
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("root");
  const streams = usePlaybackStreams(() => setPane("root"));
  const {
    qualityLabel,
    audioStreams,
    selectedAudioStreamId,
    canSelectAudio,
    audioLabel,
    subtitleStreams,
    hasSubtitles,
    selectedSubtitleStreamId,
    subtitleLabel,
    streamError,
    isUpdatingStream,
    selectStream: handleStreamSelection,
  } = streams;
  const playbackRate = usePlayerPrefsStore((state) => state.playbackRate);
  const captionSize = usePlayerPrefsStore((state) => state.captionSize);
  const autoPlayEnabled = usePlayerPrefsStore((state) => state.autoPlayEnabled);
  const setAutoPlayEnabled = usePlayerPrefsStore(
    (state) => state.setAutoPlayEnabled,
  );
  const setPlaybackRate = usePlayerPrefsStore((state) => state.setPlaybackRate);
  const setCaptionSize = usePlayerPrefsStore((state) => state.setCaptionSize);
  function handleOpenChange(next: boolean) {
    if (!next) {
      setPane("root");
      streams.clearError();
    }
    setOpen(next);
    onOpenChange?.(next);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="text-white [--control-icon-color:currentColor] hover:bg-white/20"
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
        className="w-72 overflow-hidden [&>[data-slot=popover-viewport]]:p-1.5"
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
            {canSelectAudio ? (
              <NavRow
                label="Audio Stream"
                value={audioLabel}
                onClick={() => setPane("audio")}
                disabled={isUpdatingStream}
              />
            ) : (
              <ReadOnlyRow label="Audio Stream" value={audioLabel} />
            )}
            <NavRow
              label="Subtitles"
              value={subtitleLabel}
              onClick={() => setPane("subtitles")}
              disabled={!hasSubtitles || isUpdatingStream}
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
        ) : pane === "audio" ? (
          <Pane title="Audio Stream" onBack={() => setPane("root")}>
            {audioStreams.map((stream) => (
              <SelectRow
                key={stream.id}
                label={getStreamLabel(stream, "Audio")}
                selected={stream.id === selectedAudioStreamId}
                onClick={() => void handleStreamSelection("audio", stream.id)}
                disabled={isUpdatingStream}
              />
            ))}
            {streamError && (
              <p className="text-destructive px-3 py-2 text-xs">
                {streamError}
              </p>
            )}
          </Pane>
        ) : (
          <Pane title="Subtitles" onBack={() => setPane("root")}>
            <SelectRow
              label="None"
              selected={selectedSubtitleStreamId === null}
              onClick={() => void handleStreamSelection("subtitle", null)}
              disabled={isUpdatingStream}
            />
            {subtitleStreams.map((stream) => (
              <SelectRow
                key={stream.id}
                label={getStreamLabel(stream, "Subtitle")}
                selected={stream.id === selectedSubtitleStreamId}
                onClick={() =>
                  void handleStreamSelection("subtitle", stream.id)
                }
                disabled={isUpdatingStream}
              />
            ))}
            {streamError && (
              <p className="text-destructive px-3 py-2 text-xs">
                {streamError}
              </p>
            )}
            <Separator />
            <p className="text-muted-foreground px-3 py-1 text-xs">
              Subtitle Size
            </p>
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
      <span className="text-popover-foreground/60 ml-auto truncate text-xs">
        {value}
      </span>
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
          ? "text-popover-foreground/35 cursor-not-allowed"
          : "text-popover-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "ml-auto truncate text-xs",
          disabled
            ? "text-popover-foreground/35"
            : "text-popover-foreground/60",
        )}
      >
        {value}
      </span>
      <ChevronRight
        className={cn(
          "h-4 w-4",
          disabled
            ? "text-popover-foreground/35"
            : "text-popover-foreground/60",
        )}
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
      className="text-popover-foreground hover:bg-accent hover:text-accent-foreground flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors"
    >
      <span>{label}</span>
      <span
        className={cn(
          "ml-auto inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
          checked ? "bg-primary" : "bg-input",
        )}
      >
        <span
          className={cn(
            "bg-primary-foreground h-4 w-4 rounded-full transition-transform",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}

function Separator() {
  return <div className="bg-border my-1 h-px" />;
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
        className="text-popover-foreground hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors"
      >
        <ChevronLeft
          className="text-popover-foreground/60 h-4 w-4"
          aria-hidden="true"
        />
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
      aria-pressed={selected}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        disabled
          ? "text-popover-foreground/35 cursor-not-allowed"
          : "text-popover-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <Check
        className={cn(
          "h-4 w-4",
          selected ? "text-popover-foreground" : "text-transparent",
        )}
        aria-hidden="true"
      />
      <span>{label}</span>
    </button>
  );
}

/* ────────────────────────────────────────────────────────────
   Label helpers
   ──────────────────────────────────────────────────────────── */

function formatPlaybackRate(playbackRate: PlaybackRate): string {
  return (
    PLAYBACK_RATE_OPTIONS.find((option) => option.value === playbackRate)
      ?.label ?? "Normal"
  );
}
