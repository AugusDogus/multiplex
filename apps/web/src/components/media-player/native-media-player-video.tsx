"use client";

import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { MouseEvent, PointerEvent } from "react";
import type { NativePlayerEventEncoded } from "@multiplex/desktop-contracts";
import {
  playerCommands,
  usePlayerStateSelector,
} from "~/lib/effect/player-atoms";
import { getDesktopPlayer } from "~/lib/desktop-player";
import { usePlayerPrefsStore } from "~/stores/player-prefs-store";
import { generatePlexNativePartUrl } from "./utils/plex-stream-urls";
import { useSeekOverlay } from "./hooks/use-seek-overlay";
import { MediaPlayerSeekOverlay } from "./media-player-seek-overlay";
import type {
  MediaPlayerSeekFeedbackHandle,
  MediaPlayerVideoProps,
} from "./media-player-video";

const SEEK_OVERLAY_MS = 2200;
const SEEK_SECONDS = 10;

export const NativeMediaPlayerVideo = forwardRef<
  HTMLVideoElement,
  MediaPlayerVideoProps
>(function NativeMediaPlayerVideo(
  {
    item,
    className = "",
    onVideoClick,
    onVideoDoubleClick,
    onMobileSurfaceTap,
    useMobileSurfaceGestures = false,
    isWatchTogetherActive = false,
    seekFeedbackRef,
    onVolumeScroll,
    onVideoEnded,
    onVideoPlay,
    onVideoPause,
    onVideoTimeUpdate,
    onVideoSeeking,
    onVideoSeeked,
  },
  _forwardedRef,
) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const sourceGeneration = usePlayerStateSelector(
    (state) => state.sourceGeneration,
  );
  const streamSessionId = usePlayerStateSelector(
    (state) => state.streamSessionId,
  );
  const volume = usePlayerPrefsStore((state) => state.volume);
  const isMuted = usePlayerPrefsStore((state) => state.isMuted);
  const playbackRate = usePlayerPrefsStore((state) => state.playbackRate);
  const partKey = item.Media?.[0]?.Part?.[0]?.key;
  const { overlay, showOverlay, clearOverlayTimeout } =
    useSeekOverlay(SEEK_OVERLAY_MS);

  useImperativeHandle(
    seekFeedbackRef,
    (): MediaPlayerSeekFeedbackHandle => ({
      show: showOverlay,
      presentSeek: (direction) => showOverlay(direction, SEEK_SECONDS, false),
    }),
    [showOverlay],
  );

  useEffect(() => clearOverlayTimeout, [clearOverlayTimeout]);

  const identity = {
    streamSessionId,
    serverId: item.serverId,
    ratingKey: item.ratingKey,
    sourceGeneration,
  };
  const handleNativeEvent = useEffectEvent(
    (event: NativePlayerEventEncoded) => {
      const isCurrent = () => {
        const current = playerCommands.snapshot();
        return (
          current.sourceGeneration === identity.sourceGeneration &&
          current.streamSessionId === identity.streamSessionId &&
          current.currentItem?.serverId === identity.serverId &&
          current.currentItem.ratingKey === identity.ratingKey
        );
      };
      const update = (
        updates: Parameters<typeof playerCommands.updatePlaybackStateFor>[1],
      ) =>
        isCurrent() && playerCommands.updatePlaybackStateFor(identity, updates);

      if (
        event.identity.sourceGeneration !== identity.sourceGeneration ||
        event.identity.streamSessionId !== identity.streamSessionId ||
        !isCurrent()
      ) {
        return;
      }
      switch (event._tag) {
        case "Loading":
          update({ isLoading: true, canPlay: false, error: null });
          break;
        case "Ready":
          update({
            duration: event.durationSeconds,
            isLoading: false,
            isBuffering: false,
            canPlay: true,
          });
          break;
        case "PlaybackChanged":
          if (update({ isPlaying: event.isPlaying })) {
            if (event.isPlaying) onVideoPlay?.();
            else onVideoPause?.();
          }
          break;
        case "TimeChanged":
          if (
            update({
              currentTime: event.currentTimeSeconds,
              bufferedTime: event.bufferedTimeSeconds,
            })
          ) {
            onVideoTimeUpdate?.(event.currentTimeSeconds);
          }
          break;
        case "BufferingChanged":
          update({ isBuffering: event.isBuffering });
          break;
        case "Seeked":
          if (update({ currentTime: event.currentTimeSeconds })) {
            onVideoSeeking?.(event.currentTimeSeconds);
            onVideoSeeked?.(event.currentTimeSeconds);
          }
          break;
        case "Ended":
          if (update({ isPlaying: false })) onVideoEnded?.();
          break;
        case "Error":
          update({
            error: event.message,
            isLoading: false,
            isBuffering: false,
          });
          break;
      }
    },
  );

  useEffect(() => {
    const desktopPlayer = getDesktopPlayer();
    if (!desktopPlayer || !partKey) return;

    const unsubscribe = desktopPlayer.onEvent(handleNativeEvent);

    const source = generatePlexNativePartUrl({
      serverUrl: item.serverUrl,
      authToken: item.authToken,
      partKey,
      sessionId: streamSessionId,
    });
    const snapshot = playerCommands.snapshot();
    const prefs = usePlayerPrefsStore.getState();
    void desktopPlayer.load({
      identity,
      url: source,
      title: item.title,
      startSeconds: snapshot.currentTime,
      volume: prefs.volume,
      muted: prefs.isMuted,
      playbackRate: 1,
    });

    return () => {
      unsubscribe();
      void desktopPlayer.present({ _tag: "Hidden" });
      void desktopPlayer.stop(identity);
    };
  }, [
    item.ratingKey,
    item.serverId,
    item.serverUrl,
    item.authToken,
    item.title,
    partKey,
    sourceGeneration,
    streamSessionId,
  ]);

  useEffect(() => {
    const desktopPlayer = getDesktopPlayer();
    if (!desktopPlayer) return;
    void desktopPlayer.setVolume({ identity, volume, muted: isMuted });
  }, [
    identity.ratingKey,
    identity.serverId,
    identity.sourceGeneration,
    identity.streamSessionId,
    isMuted,
    volume,
  ]);

  useEffect(() => {
    const desktopPlayer = getDesktopPlayer();
    if (!desktopPlayer) return;
    void desktopPlayer.setRate({
      identity,
      playbackRate: isWatchTogetherActive ? 1 : playbackRate,
    });
  }, [
    identity.ratingKey,
    identity.serverId,
    identity.sourceGeneration,
    identity.streamSessionId,
    isWatchTogetherActive,
    playbackRate,
  ]);

  useLayoutEffect(() => {
    const desktopPlayer = getDesktopPlayer();
    const surface = surfaceRef.current;
    if (!desktopPlayer || !surface) return;

    let frame = 0;
    const present = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = surface.getBoundingClientRect();
        void desktopPlayer.present({
          _tag: "Visible",
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          deviceScaleFactor: window.devicePixelRatio,
        });
      });
    };
    const observer = new ResizeObserver(present);
    observer.observe(surface);
    window.addEventListener("resize", present);
    present();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", present);
    };
  }, []);

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!useMobileSurfaceGestures) onVideoDoubleClick?.();
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (useMobileSurfaceGestures) onMobileSurfaceTap?.(event);
  };

  return (
    <div
      ref={surfaceRef}
      role="button"
      tabIndex={0}
      aria-label="Native video playback surface"
      className={`relative h-full w-full cursor-pointer overflow-hidden bg-transparent select-none ${className}`}
      onClick={useMobileSurfaceGestures ? undefined : onVideoClick}
      onDoubleClick={handleDoubleClick}
      onPointerUp={handlePointerUp}
      onWheel={(event) => {
        event.preventDefault();
        onVolumeScroll?.(-event.deltaY);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onVideoClick?.();
        }
      }}
    >
      <MediaPlayerSeekOverlay overlay={overlay} />
    </div>
  );
});
