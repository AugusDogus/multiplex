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
import type { MediaPlayerItem } from "~/types/media-player";
import type { PlexPlaybackPlan } from "../utils/plex-playback-plan";
import {
  generatePlexExternalSubtitleUrl,
  generatePlexSubtitleTrackUrl,
  hasValidStreamingData,
} from "../utils/plex-stream-urls";
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

  const clearTrackCues = useCallback((track: TextTrack | null) => {
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
  }, []);

  const disableTextTrack = useCallback(
    (track: TextTrack | null) => {
      if (!track) return;

      clearTrackCues(track);
      track.mode = "disabled";
    },
    [clearTrackCues],
  );

  const getOrCreateExternalTextTrack = useCallback(
    (video: HTMLVideoElement): TextTrack => {
      const existing =
        externalTextTrackRef.current ??
        Array.from(video.textTracks).find(
          (track) => track.label === EXTERNAL_SUBTITLE_TRACK_LABEL,
        ) ??
        null;

      if (existing) {
        externalTextTrackRef.current = existing;
        clearTrackCues(existing);
        return existing;
      }

      const track = video.addTextTrack(
        "subtitles",
        EXTERNAL_SUBTITLE_TRACK_LABEL,
        "en",
      );
      externalTextTrackRef.current = track;
      return track;
    },
    [clearTrackCues],
  );

  const deactivateCaptionsIfTrack = useCallback((track: TextTrack | null) => {
    if (!track) return;

    setCaptionTrack((current) => (current === track ? null : current));
  }, []);

  const clearExternalTextTrack = useCallback(() => {
    const track = externalTextTrackRef.current;
    disableTextTrack(track);
    deactivateCaptionsIfTrack(track);
    externalTextTrackRef.current = null;
  }, [deactivateCaptionsIfTrack, disableTextTrack]);

  const clearPlexTextTrack = useCallback(() => {
    const track = plexTextTrackRef.current;
    disableTextTrack(track);
    deactivateCaptionsIfTrack(track);
    plexTextTrackRef.current = null;
  }, [deactivateCaptionsIfTrack, disableTextTrack]);

  const activateCaptionTrack = useCallback((track: TextTrack) => {
    track.mode = "hidden";
    setCaptionTrack(track);
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

        const track = getOrCreateExternalTextTrack(video);

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
    getOrCreateExternalTextTrack,
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
  }, [clearExternalTextTrack, clearPlexTextTrack, playbackPlan.subtitle]);

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

  return {
    plexSubtitleTrackSrc,
    handlePlexTrackLoad,
    captionTrack,
  };
}
