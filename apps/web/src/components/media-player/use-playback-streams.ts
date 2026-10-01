"use client";
import {
  getQualityLabel,
  getAudioStreams,
  getAudioStreamLabel,
  getSubtitleStreams,
  getStreamLabel,
} from "./utils/playback-stream-info";

import { useEffect, useRef, useState } from "react";
import {
  playerCommands,
  usePlayerStateSelector,
} from "~/lib/effect/player-atoms";
import { useSyncedItemMetadata } from "~/lib/sync-engine";
import { shallow } from "zustand/shallow";
import { emitMediaPlayerDiagnostic } from "./utils/media-player-diagnostics";
import type { MediaPlayerItem } from "~/types/media-player";
import {
  buildPlexPlaybackPlan,
  playbackUsesTranscode,
  resolveSelectedAudioStream,
} from "./utils/plex-playback-plan";
import {
  buildPlexAudioSelectionUrl,
  buildPlexSubtitleSelectionUrl,
  buildPlexTranscodeSessionKey,
  markTranscodeSessionStopped,
  preparePlexTranscodeDecision,
  stopTranscodeSessionBeforeReplacement,
} from "./utils/plex-stream-urls";
import {
  applySelectedStream,
  type SelectableStreamKind,
} from "./utils/plex-stream-selection";

export function usePlaybackStreams(onSelected: () => void) {
  const { currentItem, streamSessionId } = usePlayerStateSelector(
    (state) => ({
      currentItem: state.currentItem,
      streamSessionId: state.streamSessionId,
    }),
    shallow,
  );
  const applyPlaybackMetadata = playerCommands.applyPlaybackMetadata;
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isUpdatingStream, setIsUpdatingStream] = useState(false);
  const streamSelectionInFlightRef = useRef(false);

  // `hubs/continueWatching` does not expand `Media[].Part[].Stream[]`, so the
  // shallow `currentItem` from the store has no audio or subtitle stream
  // information. Fetch the full metadata once the player has an item so the
  // settings menu can show real stream choices.
  const metadataServerId = currentItem?.serverId ?? "";
  const metadataRatingKey = currentItem?.ratingKey ?? "";
  const canQueryDetailedMetadata = currentItem?.access !== "guest-transient";
  const { data: detailedItem, refetch: refetchDetailedItem } =
    useSyncedItemMetadata(metadataServerId, metadataRatingKey, {
      enabled: Boolean(
        canQueryDetailedMetadata && metadataServerId && metadataRatingKey,
      ),
    });

  // Keep the store's `currentItem` hydrated with expanded stream metadata so
  // playback and the settings menu share one canonical stream selection.
  useEffect(() => {
    if (
      streamSelectionInFlightRef.current ||
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

  const streamSource = detailedItem ?? currentItem;
  const qualityLabel = getQualityLabel(streamSource);
  const audioStreams = getAudioStreams(streamSource);
  const selectedAudioStream = resolveSelectedAudioStream(audioStreams);
  const selectedAudioStreamId = selectedAudioStream?.id ?? null;
  const canSelectAudio = audioStreams.length > 1;
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

  const handleStreamSelection = async (
    kind: SelectableStreamKind,
    streamId: number | null,
  ) => {
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

    const isCurrentSelection =
      kind === "audio"
        ? streamId === selectedAudioStreamId
        : streamId === selectedSubtitleStreamId;
    if (isCurrentSelection) {
      onSelected();
      return;
    }

    // PMS delegation tokens can stream but cannot mutate a library part.
    // Guest playback URLs carry explicit stream IDs, so keep this choice
    // local to the invited viewer instead of sharing Plex profile state.
    let selectionUrl: string | null = null;
    if (currentItem.access !== "guest-transient") {
      if (kind === "audio") {
        if (streamId === null) {
          return;
        }
        selectionUrl = buildPlexAudioSelectionUrl(
          currentItem,
          currentItem.serverUrl,
          currentItem.authToken,
          streamId,
        );
      } else {
        selectionUrl = buildPlexSubtitleSelectionUrl(
          currentItem,
          currentItem.serverUrl,
          currentItem.authToken,
          streamId,
        );
      }
    }

    const failureMessage =
      kind === "audio"
        ? "Unable to update audio"
        : "Unable to update subtitles";
    streamSelectionInFlightRef.current = true;
    emitMediaPlayerDiagnostic({
      kind: "stream-selection-requested",
      selectionKind: kind,
      currentTimeSeconds: playerCommands.snapshot().currentTime,
    });
    setIsUpdatingStream(true);
    setStreamError(null);
    const previousUsesTranscode = playbackUsesTranscode(currentItem);

    const selectionRequest: Promise<Response | null> = selectionUrl
      ? fetch(selectionUrl, { method: "PUT" })
      : Promise.resolve(null);
    await selectionRequest
      .then(async (response) => {
        if (response && !response.ok) {
          console.error(
            `Failed to select ${kind} stream: Plex returned ${response.status}`,
          );
          emitMediaPlayerDiagnostic({
            kind: "stream-selection-request-failed",
            selectionKind: kind,
            status: response.status,
          });
          if (isCurrentPlayback()) {
            setStreamError(failureMessage);
          }
          return;
        }

        if (!isCurrentPlayback()) {
          return;
        }
        const refreshed = selectionUrl
          ? await refetchDetailedItem()
          : {
              data: applySelectedStream(currentItem, kind, streamId),
            };
        if (!isCurrentPlayback()) {
          return;
        }
        if (refreshed.data) {
          const playbackBeforeReplacement = playerCommands.snapshot();
          const preserveCurrentTime = playbackBeforeReplacement.currentTime;
          const previousItem = playbackBeforeReplacement.currentItem;
          const previousPlan = previousItem
            ? buildPlexPlaybackPlan(previousItem)
            : null;
          const previousTranscodeSession =
            previousPlan?.videoUsesTranscode &&
            playbackBeforeReplacement.transcodeSessionId
              ? buildPlexTranscodeSessionKey(
                  playbackBeforeReplacement.transcodeSessionId,
                  playbackBeforeReplacement.streamOffset,
                  previousPlan,
                )
              : null;
          const replacementItem: MediaPlayerItem = {
            ...currentItem,
            ...refreshed.data,
            serverUrl: currentItem.serverUrl,
            authToken: currentItem.authToken,
            serverId: currentItem.serverId,
          };
          const replacementPlan = buildPlexPlaybackPlan(replacementItem);
          if (previousTranscodeSession) {
            const previousStopped = await stopTranscodeSessionBeforeReplacement(
              currentItem.serverUrl,
              currentItem.authToken,
              previousTranscodeSession,
            );
            if (!previousStopped || !isCurrentPlayback()) {
              if (isCurrentPlayback()) {
                setStreamError(failureMessage);
              }
              return;
            }
          }
          const decisionReady = await preparePlexTranscodeDecision(
            replacementItem,
            currentItem.serverUrl,
            currentItem.authToken,
            replacementPlan,
            preserveCurrentTime,
            playbackIdentity.streamSessionId,
          );
          if (!decisionReady || !isCurrentPlayback()) {
            if (isCurrentPlayback()) {
              setStreamError(failureMessage);
            }
            return;
          }
          applyPlaybackMetadata(playbackIdentity, refreshed.data, {
            preserveCurrentTime,
            reloadVideo: true,
            previousVideoUsesTranscode: previousUsesTranscode,
          });
          emitMediaPlayerDiagnostic({
            kind: "stream-selection-replacement-committed",
            selectionKind: kind,
            currentTimeSeconds: preserveCurrentTime,
            previousVideoUsesTranscode: previousUsesTranscode,
            replacementVideoUsesTranscode: replacementPlan.videoUsesTranscode,
          });
          if (previousTranscodeSession) {
            markTranscodeSessionStopped(previousTranscodeSession);
          }
        }
        onSelected();
      })
      .catch((cause: unknown) => {
        console.error(`Failed to select ${kind} stream:`, cause);
        emitMediaPlayerDiagnostic({
          kind: "stream-selection-failed",
          selectionKind: kind,
        });
        if (isCurrentPlayback()) {
          setStreamError(failureMessage);
        }
      })
      .finally(() => {
        streamSelectionInFlightRef.current = false;
        setIsUpdatingStream(false);
      });
  };

  return {
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
    clearError: () => setStreamError(null),
  };
}
