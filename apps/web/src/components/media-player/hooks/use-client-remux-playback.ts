"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useMediaPlayerStore } from "~/stores/media-player-store";
import type { MediaPlayerItem } from "~/types/media-player";
import {
  attachClientRemuxPlayback,
  type ClientRemuxPlaybackHandle,
} from "../utils/client-remux-engine";
import { buildDirectPlayUrl } from "../utils/plex-stream-urls";

interface UseClientRemuxPlaybackOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Whether the current playback plan selected the client-remux path. */
  active: boolean;
  partKey: string | undefined;
  serverUrl: string;
  authToken: string;
  /**
   * Invoked on any unrecoverable engine failure. The caller is expected to
   * flip the plan to the Plex path and preserve the playback position.
   */
  onFallback: (error: unknown) => void;
}

/**
 * Attaches the in-browser remux engine to the <video> element whenever the
 * playback plan selects the client-remux path. The engine owns the element's
 * src (a MediaSource object URL) for as long as it is attached; on fallback
 * or unmount it releases the element back to URL-based playback.
 */
export function useClientRemuxPlayback({
  videoRef,
  active,
  partKey,
  serverUrl,
  authToken,
  onFallback,
}: UseClientRemuxPlaybackOptions): void {
  const streamSessionId = useMediaPlayerStore((state) => state.streamSessionId);
  const { updatePlaybackState } = useMediaPlayerStore();

  // Late-bound so engine failures always reach the newest fallback handler
  // without retriggering the attach effect.
  const onFallbackRef = useRef(onFallback);
  useEffect(() => {
    onFallbackRef.current = onFallback;
  }, [onFallback]);

  useEffect(() => {
    if (!active || !partKey) return;
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let handle: ClientRemuxPlaybackHandle | null = null;

    const fail = (error: unknown) => {
      if (disposed) return;
      console.warn(
        "Client remux failed; falling back to Plex streaming:",
        error instanceof Error ? error.message : error,
      );
      onFallbackRef.current(error);
    };

    updatePlaybackState({
      isLoading: true,
      error: null,
      canPlay: false,
      isBuffering: false,
    });

    // Minimal item shape: the direct-play URL only needs the part key.
    const streamItem = {
      Media: [{ Part: [{ key: partKey }] }],
    } as MediaPlayerItem;

    let mediaUrl: string;
    try {
      mediaUrl = buildDirectPlayUrl(
        streamItem,
        serverUrl,
        authToken,
        streamSessionId || `multiplex-${Date.now()}`,
      );
    } catch (error) {
      fail(error);
      return;
    }

    attachClientRemuxPlayback({
      video,
      mediaUrl,
      startTime: useMediaPlayerStore.getState().currentTime,
      onFatalError: fail,
    })
      .then((attached) => {
        if (disposed) {
          attached.destroy();
          return;
        }
        handle = attached;
        console.info("🎬 Client remux pipeline:", attached.info);
      })
      .catch(fail);

    return () => {
      disposed = true;
      handle?.destroy();
      handle = null;
    };
  }, [
    active,
    authToken,
    partKey,
    serverUrl,
    streamSessionId,
    updatePlaybackState,
    videoRef,
  ]);
}
