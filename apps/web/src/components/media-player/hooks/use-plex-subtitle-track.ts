"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type SyntheticEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import type { MediaPlayerItem } from "~/types/media-player";
import type { PlexPlaybackPlan } from "../utils/plex-playback-plan";
import {
  generatePlexExternalSubtitleUrl,
  generatePlexSubtitleTrackUrl,
  hasValidStreamingData,
} from "../utils/plex-stream-urls";
import { parseSrtCues, shiftSrtCues } from "../utils/srt-parser";

const EXTERNAL_SUBTITLE_TRACK_LABEL = "Multiplex External";

type MutableValue<T> = { current: T };

function clearTrackCues(track: TextTrack | null) {
  if (!track?.cues) return;
  for (let index = track.cues.length - 1; index >= 0; index -= 1) {
    const cue = track.cues[index];
    if (cue) track.removeCue(cue);
  }
}

function disableTextTrack(track: TextTrack | null) {
  if (!track) return;
  clearTrackCues(track);
  track.mode = "disabled";
}

function deactivateCaptionsIfTrack(
  setCaptionTrack: Dispatch<SetStateAction<TextTrack | null>>,
  track: TextTrack | null,
) {
  if (!track) return;
  setCaptionTrack((current) => (current === track ? null : current));
}

function clearTextTrack(
  trackRef: MutableValue<TextTrack | null>,
  setCaptionTrack: Dispatch<SetStateAction<TextTrack | null>>,
) {
  const track = trackRef.current;
  disableTextTrack(track);
  deactivateCaptionsIfTrack(setCaptionTrack, track);
  trackRef.current = null;
}

function getOrCreateExternalTextTrack(
  video: HTMLVideoElement,
  trackRef: MutableValue<TextTrack | null>,
): TextTrack {
  const existing =
    trackRef.current ??
    Array.from(video.textTracks).find(
      (track) => track.label === EXTERNAL_SUBTITLE_TRACK_LABEL,
    ) ??
    null;
  if (existing) {
    trackRef.current = existing;
    clearTrackCues(existing);
    return existing;
  }

  const track = video.addTextTrack(
    "subtitles",
    EXTERNAL_SUBTITLE_TRACK_LABEL,
    "en",
  );
  trackRef.current = track;
  return track;
}

function activateCaptionTrack(
  track: TextTrack,
  setCaptionTrack: Dispatch<SetStateAction<TextTrack | null>>,
) {
  track.mode = "hidden";
  setCaptionTrack(track);
}

export function usePlexSubtitleTrack(
  videoRef: RefObject<HTMLVideoElement | null>,
  item: MediaPlayerItem,
  playbackPlan: PlexPlaybackPlan,
  subtitleTimelineOffset = 0,
) {
  const externalTextTrackRef = useRef<TextTrack | null>(null);
  const plexTextTrackRef = useRef<TextTrack | null>(null);
  const [captionTrack, setCaptionTrack] = useState<TextTrack | null>(null);

  const plexSubtitleTrackSrc = (() => {
    if (
      playbackPlan.subtitle.kind !== "plexTrack" ||
      !hasValidStreamingData(item)
    ) {
      return null;
    }

    try {
      return generatePlexSubtitleTrackUrl(
        item,
        item.serverUrl,
        item.authToken,
        playbackPlan.subtitle.index,
      );
    } catch (error) {
      console.error(
        "Failed to generate subtitle URL:",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  })();

  const externalSubtitleUrl =
    playbackPlan.subtitle.kind === "externalText" && hasValidStreamingData(item)
      ? generatePlexExternalSubtitleUrl(
          item.serverUrl,
          item.authToken,
          playbackPlan.subtitle.key,
        )
      : null;
  const externalSubtitleQuery = useQuery({
    queryKey: ["plex-external-subtitle", externalSubtitleUrl],
    queryFn: async ({ signal }) => {
      if (!externalSubtitleUrl) return null;
      const response = await fetch(externalSubtitleUrl, {
        headers: { Accept: "text/plain,*/*" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) {
        // TanStack Query owns this Promise boundary and exposes the rejection
        // through `externalSubtitleQuery.error` below.
        throw new Error(
          `Plex subtitle request failed with status ${response.status}`,
        );
      }
      return response.text();
    },
    enabled: externalSubtitleUrl !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (!externalSubtitleUrl) {
      clearTextTrack(externalTextTrackRef, setCaptionTrack);
      return;
    }

    if (externalSubtitleQuery.error) {
      console.error(
        "Failed to load external subtitle stream.",
        externalSubtitleQuery.error,
      );
      clearTextTrack(externalTextTrackRef, setCaptionTrack);
      return;
    }

    const subtitleText = externalSubtitleQuery.data;
    if (!subtitleText) return;

    const video = videoRef.current;
    if (!video || typeof VTTCue === "undefined") return;

    clearTextTrack(plexTextTrackRef, setCaptionTrack);
    const track = getOrCreateExternalTextTrack(video, externalTextTrackRef);
    const cueData = shiftSrtCues(
      parseSrtCues(subtitleText),
      subtitleTimelineOffset,
    );
    for (const cue of cueData) {
      track.addCue(new VTTCue(cue.startTime, cue.endTime, cue.text));
    }
    activateCaptionTrack(track, setCaptionTrack);
  }, [
    externalSubtitleQuery.data,
    externalSubtitleQuery.error,
    externalSubtitleUrl,
    subtitleTimelineOffset,
    videoRef,
  ]);

  useEffect(() => {
    const { kind } = playbackPlan.subtitle;

    if (kind === "plexTrack") {
      clearTextTrack(externalTextTrackRef, setCaptionTrack);
      return;
    }

    if (kind === "externalText") {
      clearTextTrack(plexTextTrackRef, setCaptionTrack);
      return;
    }

    clearTextTrack(externalTextTrackRef, setCaptionTrack);
    clearTextTrack(plexTextTrackRef, setCaptionTrack);
  }, [playbackPlan.subtitle]);

  const handlePlexTrackLoad = (event: SyntheticEvent<HTMLTrackElement>) => {
    const track = event.currentTarget.track;
    if (!track) return;

    clearTextTrack(externalTextTrackRef, setCaptionTrack);
    plexTextTrackRef.current = track;
    activateCaptionTrack(track, setCaptionTrack);
  };

  return {
    plexSubtitleTrackSrc,
    handlePlexTrackLoad,
    captionTrack,
  };
}
