import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Video, ResizeMode, type AVPlaybackStatus } from "expo-av";
import { useNavigation, useRoute } from "@react-navigation/native";
import {
  createRoomDelayMs,
  DISCOVERY_POLL_MS,
  EVERYONE_JOINED_GRACE_MS,
  findNextEpisodeRoom,
  getAutoAdvanceRank,
  haveMultiplexParticipantsJoined,
  mergeParticipantState,
  MULTIPLEX_SYNCPLAY_DEVICE_NAME,
  SyncplayClient,
  SyncplaySessionController,
  type Marker,
  type ParticipantMap,
  type SyncplayPlayerState,
  type SyncplayUser,
} from "@multiplex/plex-query";
import { Button } from "heroui-native/button";

import { api } from "~/api";
import { Text } from "~/components/text";
import { buildMobilePlaybackSource, stopMobileTranscode } from "~/lib/playback";
import { readAutoPlayEnabled, storeAutoPlayEnabled } from "~/lib/player-preferences";
import type { RootStackParamList } from "~/navigation/types";

function createSessionId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const INITIAL_PLAYER_STATE: SyncplayPlayerState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  canPlay: false,
  isLoading: true,
  error: null,
};

interface NextQueueItem {
  readonly ratingKey: string;
  readonly key: string;
  readonly title: string;
}

export function PlayerScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Player">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const videoRef = useRef<Video>(null);
  const playbackSessionId = useRef(createSessionId("multiplex-mobile"));
  const clientIdentifier = useRef(createSessionId("device"));
  const stateRef = useRef<SyncplayPlayerState>(INITIAL_PLAYER_STATE);
  const controllerRef = useRef<SyncplaySessionController | null>(null);
  const lastTimelineAt = useRef(0);
  const lastPlayback = useRef<{ isPlaying: boolean; currentTime: number } | null>(null);
  const [offsetSeconds, setOffsetSeconds] = useState(route.params.startAtSeconds ?? 0);
  const [rate, setRate] = useState(1);
  const [subtitleStreamId, setSubtitleStreamId] = useState<number | null | undefined>(undefined);
  const [subtitleSizePercent, setSubtitleSizePercent] = useState(100);
  const [audioStreamId, setAudioStreamId] = useState<number | null | undefined>(undefined);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState(true);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [nextEpisode, setNextEpisode] = useState<NextQueueItem | null>(null);
  const [participants, setParticipants] = useState<ParticipantMap>({});
  const [nextRoomParticipants, setNextRoomParticipants] = useState<ParticipantMap>({});
  const [playbackEndedAt, setPlaybackEndedAt] = useState<number | null>(null);
  const queueIdentity = useRef<string | null>(null);
  const autoAdvanced = useRef(false);
  const rotationCreateScheduled = useRef(false);
  const rotationCreateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const details = api.plex.getItemDetails.useQuery({
    serverId: route.params.serverId,
    ratingKey: route.params.ratingKey,
  });
  const room = api.plex.getWatchTogetherRoom.useQuery(
    { roomId: route.params.roomId ?? "" },
    { enabled: Boolean(route.params.roomId) },
  );
  const user = api.plex.getUserInfo.useQuery(undefined, {
    enabled: Boolean(route.params.roomId),
  });
  const rotationRooms = api.plex.getWatchTogetherRooms.useQuery(undefined, {
    enabled: Boolean(route.params.roomId && nextEpisode && autoPlayEnabled),
    refetchInterval: DISCOVERY_POLL_MS,
  });
  const timeline = api.plex.sendTimeline.useMutation();
  const createQueue = api.plex.createPlayQueue.useMutation();
  const createNextRoom = api.plex.createWatchTogetherRoom.useMutation();

  const localSyncplayUser = useMemo<SyncplayUser | null>(
    () =>
      user.data
        ? {
            id: user.data.id,
            deviceIdentifier: clientIdentifier.current,
            deviceName: MULTIPLEX_SYNCPLAY_DEVICE_NAME,
          }
        : null,
    [user.data],
  );

  const target = details.data?.playTarget ?? null;
  const source = useMemo(() => {
    if (!target || !details.data?.serverUrl || !details.data.authToken) return null;
    return buildMobilePlaybackSource({
      item: target,
      serverUrl: details.data.serverUrl,
      authToken: details.data.authToken,
      clientIdentifier: clientIdentifier.current,
      playbackSessionId: playbackSessionId.current,
      offsetSeconds,
      subtitleStreamId,
      subtitleSizePercent,
      audioStreamId,
    });
  }, [
    audioStreamId,
    details.data?.authToken,
    details.data?.serverUrl,
    offsetSeconds,
    subtitleSizePercent,
    subtitleStreamId,
    target,
  ]);

  useEffect(() => {
    let active = true;
    void readAutoPlayEnabled().then(
      (enabled) => {
        if (active) setAutoPlayEnabled(enabled);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    const identity = `${route.params.serverId}-${target.ratingKey}`;
    if (queueIdentity.current === identity) return;
    queueIdentity.current = identity;
    createQueue.mutate(
      {
        serverId: route.params.serverId,
        type: "video",
        ratingKey: target.ratingKey,
        key: target.key,
        continuous: true,
        includeMarkers: true,
        includeChapters: true,
      },
      {
        onSuccess: (queue) => {
          const items = queue.MediaContainer.Metadata ?? [];
          const index = items.findIndex((item) => item.ratingKey === target.ratingKey);
          const current = index >= 0 ? items[index] : undefined;
          const next = index >= 0 ? items[index + 1] : undefined;
          setMarkers(current?.Marker ?? []);
          setNextEpisode(
            next ? { ratingKey: next.ratingKey, key: next.key, title: next.title } : null,
          );
        },
      },
    );
  }, [createQueue, route.params.serverId, target]);

  const nextRoom = useMemo(() => {
    if (!room.data || !nextEpisode) return null;
    return findNextEpisodeRoom({
      rooms: rotationRooms.data ?? [],
      serverId: route.params.serverId,
      nextRatingKey: nextEpisode.ratingKey,
      currentRoom: room.data,
    });
  }, [nextEpisode, room.data, rotationRooms.data, route.params.serverId]);

  const seek = useCallback(
    (positionSeconds: number): "direct" | "reload" | "none" => {
      if (!source || !videoRef.current) return "none";
      if (source.usesTranscode) {
        setOffsetSeconds(Math.max(0, positionSeconds));
        return "reload";
      }
      void videoRef.current.setPositionAsync(Math.max(0, positionSeconds) * 1_000);
      return "direct";
    },
    [source],
  );

  useEffect(() => {
    if (!room.data || !localSyncplayUser) return;
    const controller = new SyncplaySessionController({
      room: room.data,
      user: localSyncplayUser,
      onParticipant: (participant) =>
        setParticipants((current) => mergeParticipantState(current, participant)),
      player: {
        getState: () => stateRef.current,
        play: async () => {
          const video = videoRef.current;
          if (!video) return false;
          await video.playAsync();
          return true;
        },
        pause: () => {
          void videoRef.current?.pauseAsync();
        },
        seek,
      },
    });
    controller.connect();
    controllerRef.current = controller;
    return () => {
      controller.disconnect();
      controllerRef.current = null;
    };
  }, [localSyncplayUser, room.data, seek]);

  useEffect(() => {
    if (!nextRoom || !localSyncplayUser) return;
    setNextRoomParticipants({});
    const observer = new SyncplayClient({
      room: nextRoom,
      user: localSyncplayUser,
      observer: true,
      onParticipant: (participant) =>
        setNextRoomParticipants((current) => mergeParticipantState(current, participant)),
    });
    observer.connect();
    observer.setReady(null);
    return () => observer.disconnect();
  }, [localSyncplayUser, nextRoom]);

  useEffect(() => {
    if (
      !route.params.roomId ||
      !autoPlayEnabled ||
      !room.data ||
      !localSyncplayUser ||
      !nextEpisode ||
      nextRoom ||
      rotationCreateScheduled.current ||
      currentTimeSeconds <= 5 ||
      durationSeconds <= 0 ||
      durationSeconds - currentTimeSeconds > 45
    ) {
      return;
    }
    rotationCreateScheduled.current = true;
    const rank = getAutoAdvanceRank(participants, localSyncplayUser);
    rotationCreateTimer.current = setTimeout(
      () => {
        rotationCreateTimer.current = null;
        createNextRoom.mutate(
          {
            serverId: route.params.serverId,
            ratingKey: nextEpisode.ratingKey,
            key: nextEpisode.key,
            title: nextEpisode.title,
            users: room.data.users.flatMap((roomUser) =>
              roomUser.id === localSyncplayUser.id ? [] : [roomUser.id],
            ),
          },
          {
            onSuccess: () => void rotationRooms.refetch(),
            onError: () => {
              rotationCreateScheduled.current = false;
            },
          },
        );
      },
      createRoomDelayMs(Math.max(0, rank)),
    );
  }, [
    createNextRoom,
    autoPlayEnabled,
    currentTimeSeconds,
    durationSeconds,
    localSyncplayUser,
    nextEpisode,
    nextRoom,
    participants,
    room.data,
    rotationRooms,
    route.params.roomId,
    route.params.serverId,
  ]);

  useEffect(() => {
    if (!nextRoom || !rotationCreateTimer.current) return;
    clearTimeout(rotationCreateTimer.current);
    rotationCreateTimer.current = null;
  }, [nextRoom]);

  useEffect(() => {
    const timerRef = rotationCreateTimer;
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!playbackEndedAt || !nextRoom || !nextEpisode || !localSyncplayUser) return;
    const everyoneJoined = haveMultiplexParticipantsJoined(
      participants,
      nextRoomParticipants,
      localSyncplayUser,
    );
    const delay = everyoneJoined
      ? 0
      : Math.max(0, EVERYONE_JOINED_GRACE_MS - (Date.now() - playbackEndedAt));
    const timer = setTimeout(() => {
      autoAdvanced.current = true;
      navigation.replace("Player", {
        serverId: route.params.serverId,
        ratingKey: nextEpisode.ratingKey,
        roomId: nextRoom.id,
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [
    localSyncplayUser,
    navigation,
    nextEpisode,
    nextRoom,
    nextRoomParticipants,
    participants,
    playbackEndedAt,
    route.params.serverId,
  ]);

  useEffect(() => {
    const currentSource = source;
    const data = details.data;
    const currentClientIdentifier = clientIdentifier.current;
    const currentPlaybackSessionId = playbackSessionId.current;
    return () => {
      if (currentSource?.transcodeSessionKey && data?.serverUrl && data.authToken) {
        void stopMobileTranscode({
          serverUrl: data.serverUrl,
          authToken: data.authToken,
          clientIdentifier: currentClientIdentifier,
          playbackSessionId: currentPlaybackSessionId,
          transcodeSessionKey: currentSource.transcodeSessionKey,
        });
      }
    };
  }, [details.data, source]);

  const onPlaybackStatusUpdate = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) {
        stateRef.current = {
          ...stateRef.current,
          isLoading: true,
          error: status.error ?? null,
        };
        return;
      }

      const sourceOffset = source?.usesTranscode ? offsetSeconds : 0;
      const currentTime = sourceOffset + status.positionMillis / 1_000;
      const duration = (status.durationMillis ?? 0) / 1_000 + sourceOffset;
      const nextState: SyncplayPlayerState = {
        isPlaying: status.isPlaying,
        currentTime,
        duration,
        canPlay: status.isLoaded,
        isLoading: status.isBuffering,
        error: null,
      };
      stateRef.current = nextState;
      setCurrentTimeSeconds(Math.floor(currentTime));
      setDurationSeconds(Math.floor(duration));
      controllerRef.current?.setReady(true);

      const previous = lastPlayback.current;
      if (previous && previous.isPlaying !== status.isPlaying && !status.isBuffering) {
        controllerRef.current?.handleLocalPlaybackChange(!status.isPlaying);
      }
      if (previous) {
        const expectedAdvance = previous.isPlaying ? 0.5 * rate : 0;
        if (Math.abs(currentTime - previous.currentTime - expectedAdvance) > 3) {
          controllerRef.current?.handleLocalSeeked(currentTime);
        }
      }
      lastPlayback.current = { isPlaying: status.isPlaying, currentTime };

      if (status.didJustFinish && nextEpisode && autoPlayEnabled && !autoAdvanced.current) {
        if (route.params.roomId) {
          setPlaybackEndedAt((current) => current ?? Date.now());
        } else {
          autoAdvanced.current = true;
          navigation.replace("Player", {
            serverId: route.params.serverId,
            ratingKey: nextEpisode.ratingKey,
          });
          return;
        }
      }

      const playbackItem = target;
      if (playbackItem && Date.now() - lastTimelineAt.current >= 10_000 && !timeline.isPending) {
        lastTimelineAt.current = Date.now();
        timeline.mutate({
          serverId: route.params.serverId,
          ratingKey: playbackItem.ratingKey,
          key: playbackItem.key,
          playbackTime: currentTime,
          time: currentTime * 1_000,
          duration: duration * 1_000,
          state: status.isBuffering ? "buffering" : status.isPlaying ? "playing" : "paused",
          sessionId: playbackSessionId.current,
        });
      }
    },
    [
      navigation,
      nextEpisode,
      autoPlayEnabled,
      offsetSeconds,
      rate,
      route.params.roomId,
      route.params.serverId,
      source?.usesTranscode,
      target,
      timeline,
    ],
  );

  if (details.isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-black">
        <ActivityIndicator color="white" />
      </SafeAreaView>
    );
  }
  if (details.isError || !details.data || !target || !source) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-3 bg-black px-8">
        <Text className="text-center text-lg font-semibold text-white">Playback unavailable</Text>
        <Text className="text-center text-sm text-white/60">
          This item has no playable stream or its Plex server is offline.
        </Text>
      </SafeAreaView>
    );
  }

  const streams = target.Media?.[0]?.Part?.[0]?.Stream ?? [];
  const subtitleStreams = streams.filter((stream) => stream.streamType === 3);
  const audioStreams = streams.filter((stream) => stream.streamType === 2);
  const activeMarker = markers.find(
    (marker) =>
      currentTimeSeconds * 1_000 >= marker.startTimeOffset &&
      currentTimeSeconds * 1_000 < marker.endTimeOffset,
  );

  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="flex-1 justify-center">
        <Video
          ref={videoRef}
          key={source.uri}
          source={{ uri: source.uri }}
          shouldPlay
          positionMillis={source.usesTranscode ? 0 : offsetSeconds * 1_000}
          style={{ width: "100%", aspectRatio: 16 / 9 }}
          resizeMode={ResizeMode.CONTAIN}
          useNativeControls
          rate={rate}
          progressUpdateIntervalMillis={500}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
        />
      </View>
      <ScrollView className="max-h-[42%]" contentContainerClassName="gap-3 px-4 pb-5">
        <Text className="text-lg font-semibold text-white" numberOfLines={1}>
          {target.title}
        </Text>
        {route.params.roomId ? (
          <Text className="text-xs text-white/60">Watch Together sync is active</Text>
        ) : null}
        {activeMarker ? (
          <Button size="sm" onPress={() => seek(activeMarker.endTimeOffset / 1_000)}>
            Skip {activeMarker.type}
          </Button>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {[0.5, 1, 1.25, 1.5, 2].map((value) => (
            <Button
              key={value}
              size="sm"
              variant={rate === value ? "primary" : "secondary"}
              onPress={() => {
                setRate(value);
                void videoRef.current?.setRateAsync(value, true);
              }}
            >
              {value}×
            </Button>
          ))}
          <Button
            size="sm"
            variant="secondary"
            onPress={() => void videoRef.current?.presentFullscreenPlayer()}
          >
            Full screen
          </Button>
          <Button
            size="sm"
            variant={autoPlayEnabled ? "primary" : "secondary"}
            onPress={() => {
              const enabled = !autoPlayEnabled;
              setAutoPlayEnabled(enabled);
              void storeAutoPlayEnabled(enabled).then(undefined, () => undefined);
            }}
          >
            Auto-play {autoPlayEnabled ? "on" : "off"}
          </Button>
        </View>
        {subtitleStreams.length > 0 ? (
          <View className="gap-2">
            <Text className="text-xs font-semibold tracking-wider text-white/60 uppercase">
              Subtitles
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Button
                size="sm"
                variant={subtitleStreamId === null ? "primary" : "secondary"}
                onPress={() => setSubtitleStreamId(null)}
              >
                Off
              </Button>
              {subtitleStreams.map((stream) => (
                <Button
                  key={stream.id}
                  size="sm"
                  variant={
                    subtitleStreamId === stream.id ||
                    (subtitleStreamId === undefined && stream.selected)
                      ? "primary"
                      : "secondary"
                  }
                  onPress={() => setSubtitleStreamId(stream.id)}
                >
                  {stream.displayTitle ?? stream.language ?? `Track ${stream.id}`}
                </Button>
              ))}
              {[75, 100, 125].map((size) => (
                <Button
                  key={size}
                  size="sm"
                  variant={subtitleSizePercent === size ? "primary" : "ghost"}
                  onPress={() => setSubtitleSizePercent(size)}
                >
                  {size}%
                </Button>
              ))}
            </View>
          </View>
        ) : null}
        {audioStreams.length > 1 ? (
          <View className="gap-2">
            <Text className="text-xs font-semibold tracking-wider text-white/60 uppercase">
              Audio
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {audioStreams.map((stream) => (
                <Button
                  key={stream.id}
                  size="sm"
                  variant={
                    audioStreamId === stream.id || (audioStreamId === undefined && stream.selected)
                      ? "primary"
                      : "secondary"
                  }
                  onPress={() => setAudioStreamId(stream.id)}
                >
                  {stream.displayTitle ?? stream.language ?? `Track ${stream.id}`}
                </Button>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
