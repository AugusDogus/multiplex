"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { getActiveCaptionLines } from "../utils/caption-text";
import type { MediaPlayerItem } from "~/types/media-player";
import {
  generatePlexExternalSubtitleUrl,
  generatePlexSubtitleTrackUrl,
  hasValidStreamingData,
  type PlexPlaybackPlan,
} from "../utils/plex-stream-utils";
import { parseSrtCues, shiftSrtCues } from "../utils/srt-parser";

const EXTERNAL_SUBTITLE_TRACK_LABEL = "Multiplex External";

export function usePlexSubtitleTrack(
  videoRef: RefObject<HTMLVideoElement | null>,
  item: MediaPlayerItem,
  playbackPlan: PlexPlaybackPlan,
  subtitleTimelineOffset = 0,
) {
  const externalTextTrackRef = useRef<TextTrack | null>(null);
  const plexTextTrackRef = useRef<TextTrack | null>(null);
  const [captionTrack, setCaptionTrack] = useState<TextTrack | null>(null);
  const [activeCaptions, setActiveCaptions] = useState<string[]>([]);

  const plexSubtitleTrackSrc = useMemo(() => {
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
  }, [item, playbackPlan.subtitle]);

  const disableTextTrack = useCallback((track: TextTrack | null) => {
    if (!track) return;

    const cues = track.cues;
    if (cues) {
      for (let index = cues.length - 1; index >= 0; index -= 1) {
        const cue = cues[index];
        if (cue) {
          track.removeCue(cue);
        }
      }
    }
    track.mode = "disabled";
  }, []);

  const clearExternalTextTrack = useCallback(() => {
    disableTextTrack(externalTextTrackRef.current);
    externalTextTrackRef.current = null;
    setCaptionTrack(null);
  }, [disableTextTrack]);

  const clearPlexTextTrack = useCallback(() => {
    disableTextTrack(plexTextTrackRef.current);
    plexTextTrackRef.current = null;
    setCaptionTrack(null);
  }, [disableTextTrack]);

  const activateCaptionTrack = useCallback((track: TextTrack) => {
    track.mode = "hidden";
    setCaptionTrack(track);
    setActiveCaptions(getActiveCaptionLines(track));
  }, []);

  useEffect(() => {
    if (
      playbackPlan.subtitle.kind !== "externalText" ||
      !hasValidStreamingData(item)
    ) {
      clearExternalTextTrack();
      return;
    }

    let isCancelled = false;
    const externalSubtitleUrl = generatePlexExternalSubtitleUrl(
      item.serverUrl,
      item.authToken,
      playbackPlan.subtitle.key,
    );

    void (async () => {
      try {
        const response = await fetch(externalSubtitleUrl, {
          headers: { Accept: "text/plain,*/*" },
          signal: AbortSignal.timeout(8000),
        });
        const subtitleText = await response.text();
        const cueData = shiftSrtCues(
          parseSrtCues(subtitleText),
          subtitleTimelineOffset,
        );

        if (isCancelled) return;

        const video = videoRef.current;
        if (!video || typeof VTTCue === "undefined") {
          return;
        }

        clearPlexTextTrack();
        clearExternalTextTrack();

        const track =
          externalTextTrackRef.current ??
          video.addTextTrack(
            "subtitles",
            EXTERNAL_SUBTITLE_TRACK_LABEL,
            "en",
          );
        externalTextTrackRef.current = track;

        for (const cue of cueData) {
          track.addCue(new VTTCue(cue.startTime, cue.endTime, cue.text));
        }
        activateCaptionTrack(track);
      } catch (error) {
        console.error(
          "Failed to load external subtitle stream:",
          error instanceof Error ? error.message : error,
        );
        if (!isCancelled) clearExternalTextTrack();
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [
    activateCaptionTrack,
    clearExternalTextTrack,
    clearPlexTextTrack,
    item,
    playbackPlan.subtitle,
    subtitleTimelineOffset,
    videoRef,
  ]);

  useEffect(() => {
    const { kind } = playbackPlan.subtitle;

    if (kind === "plexTrack") {
      clearExternalTextTrack();
      return;
    }

    if (kind === "externalText") {
      clearPlexTextTrack();
      return;
    }

    clearExternalTextTrack();
    clearPlexTextTrack();
  }, [
    clearExternalTextTrack,
    clearPlexTextTrack,
    playbackPlan.subtitle,
  ]);

  const handlePlexTrackLoad = useCallback(
    (event: SyntheticEvent<HTMLTrackElement>) => {
      const track = event.currentTarget.track;
      if (!track) return;

      clearExternalTextTrack();
      plexTextTrackRef.current = track;
      activateCaptionTrack(track);
    },
    [activateCaptionTrack, clearExternalTextTrack],
  );

  useEffect(() => {
    if (!captionTrack) {
      setActiveCaptions([]);
      return;
    }

    const handleCueChange = () => {
      setActiveCaptions(getActiveCaptionLines(captionTrack));
    };

    captionTrack.addEventListener("cuechange", handleCueChange);
    handleCueChange();

    return () => {
      captionTrack.removeEventListener("cuechange", handleCueChange);
    };
  }, [captionTrack]);

  return {
    plexSubtitleTrackSrc,
    handlePlexTrackLoad,
    activeCaptions,
  };
}
