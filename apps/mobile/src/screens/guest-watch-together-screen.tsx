import type { AVPlaybackStatus } from "expo-av";
import type {
  GuestWatchTogetherBootstrapValue,
  SyncplayParticipantState,
  SyncplayPlayerState,
  SyncplayUser,
} from "@multiplex/plex-query";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Video, ResizeMode } from "expo-av";
import { Button } from "heroui-native/button";
import { Input } from "heroui-native/input";
import {
  AUTO_START_DELAY_MS,
  createGuestDeviceIdentifier,
  createGuestSyncplayUser,
  SyncplayClient,
  SyncplaySessionController,
} from "@multiplex/plex-query";

import { Text } from "~/components/text";
import {
  bootstrapGuestInvite,
  continueGuestInvite,
  type GuestContinuationResult,
} from "~/lib/guest-invite";
import { buildMobilePlaybackSource, stopMobileTranscode } from "~/lib/playback";

type GuestState =
  | { readonly kind: "form" }
  | { readonly kind: "joining" }
  | {
      readonly kind: "lobby";
      readonly capability: string;
      readonly value: GuestWatchTogetherBootstrapValue;
      readonly user: SyncplayUser;
    }
  | {
      readonly kind: "playing";
      readonly capability: string;
      readonly value: GuestWatchTogetherBootstrapValue;
      readonly user: SyncplayUser;
      readonly startAtSeconds: number;
    }
  | { readonly kind: "unavailable"; readonly message: string };

function deviceIdentifier(): string {
  return createGuestDeviceIdentifier(
    () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
}

export function GuestWatchTogetherScreen({
  capability,
  onClose,
}: {
  capability: string;
  onClose: () => void;
}) {
  const [nickname, setNickname] = useState("");
  const [state, setState] = useState<GuestState>({ kind: "form" });
  const [pendingContinuation, setPendingContinuation] = useState<GuestContinuationResult | null>(
    null,
  );
  const [playbackEnded, setPlaybackEnded] = useState(false);

  const startPlayback = useCallback((startAtSeconds: number) => {
    setState((current) =>
      current.kind === "lobby" ? { ...current, kind: "playing", startAtSeconds } : current,
    );
  }, []);

  useEffect(() => {
    if (state.kind !== "playing" || !state.value.nextEpisode || pendingContinuation) return;
    let active = true;
    const poll = async () => {
      const result = await continueGuestInvite({
        capability: state.capability,
        nextRatingKey: state.value.nextEpisode?.ratingKey ?? "",
      });
      if (active && result.kind !== "pending") setPendingContinuation(result);
    };
    void poll();
    const interval = setInterval(() => void poll(), 4_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pendingContinuation, state]);

  useEffect(() => {
    if (!playbackEnded || pendingContinuation?.kind !== "ready" || state.kind !== "playing") {
      return;
    }
    setPlaybackEnded(false);
    setPendingContinuation(null);
    setState({
      kind: "lobby",
      capability: pendingContinuation.capability,
      value: pendingContinuation.value,
      user: createGuestSyncplayUser({
        guestUserId: pendingContinuation.value.guest.id,
        nickname,
        deviceIdentifier: state.user.deviceIdentifier,
      }),
    });
  }, [nickname, pendingContinuation, playbackEnded, state]);

  const join = async () => {
    const displayName = nickname.trim();
    if (!displayName || state.kind === "joining") return;
    setState({ kind: "joining" });
    const result = await bootstrapGuestInvite(capability);
    if (result.kind === "unavailable") {
      setState(result);
      return;
    }
    setState({
      kind: "lobby",
      capability,
      value: result.value,
      user: createGuestSyncplayUser({
        guestUserId: result.value.guest.id,
        nickname: displayName,
        deviceIdentifier: deviceIdentifier(),
      }),
    });
  };

  if (state.kind === "lobby") {
    return (
      <GuestLobby
        value={state.value}
        user={state.user}
        nickname={nickname}
        onClose={onClose}
        onStart={startPlayback}
      />
    );
  }

  if (state.kind === "playing") {
    return (
      <GuestPlayer
        key={state.value.room.id}
        value={state.value}
        user={state.user}
        startAtSeconds={state.startAtSeconds}
        waitingForNext={
          playbackEnded && Boolean(state.value.nextEpisode) && pendingContinuation?.kind !== "ready"
        }
        onEnded={() => setPlaybackEnded(true)}
        onClose={onClose}
      />
    );
  }

  return (
    <SafeAreaView className="bg-background flex-1 px-5 py-4">
      <View className="flex-row justify-end">
        <Button size="sm" variant="ghost" onPress={onClose}>
          Close
        </Button>
      </View>
      <View className="flex-1 items-center justify-center gap-5">
        <View className="bg-accent size-16 items-center justify-center rounded-3xl">
          <Text className="text-3xl text-black">▶</Text>
        </View>
        <View className="items-center gap-2">
          <Text className="text-3xl font-bold tracking-tight">Join Watch Together</Text>
          <Text className="text-muted max-w-80 text-center text-sm leading-6">
            Enter a name so the host can recognize this device. You do not need a Plex account.
          </Text>
        </View>
        {state.kind === "unavailable" ? (
          <View className="items-center gap-3">
            <Text className="text-danger max-w-80 text-center text-sm">{state.message}</Text>
            <Button variant="secondary" onPress={() => setState({ kind: "form" })}>
              Try again
            </Button>
          </View>
        ) : (
          <View className="w-full max-w-sm gap-3">
            <Input
              autoFocus
              maxLength={40}
              placeholder="Display name"
              value={nickname}
              onChangeText={setNickname}
              onSubmitEditing={() => void join()}
            />
            <Button isDisabled={!nickname.trim() || state.kind === "joining"} onPress={join}>
              {state.kind === "joining" ? "Joining…" : "Join session"}
            </Button>
          </View>
        )}
        <Text className="text-muted max-w-sm text-center text-xs leading-5">
          This link grants temporary access to the host's Plex Guest profile. Only open links from
          someone you trust.
        </Text>
      </View>
    </SafeAreaView>
  );
}

function GuestLobby({
  value,
  user,
  nickname,
  onStart,
  onClose,
}: {
  value: GuestWatchTogetherBootstrapValue;
  user: SyncplayUser;
  nickname: string;
  onStart: (startAtSeconds: number) => void;
  onClose: () => void;
}) {
  const [participants, setParticipants] = useState<Record<string, SyncplayParticipantState>>({});
  const [roomPositionSeconds, setRoomPositionSeconds] = useState<number | null>(null);
  const hostWatching = Object.values(participants).some(
    (participant) => participant.user.id === value.host.id && participant.isReady,
  );

  useEffect(() => {
    const client = new SyncplayClient({
      room: value.room,
      user,
      observer: true,
      onParticipant: (participant) =>
        setParticipants((current) => ({
          ...current,
          [participant.user.deviceIdentifier]: participant,
        })),
      onRoomState: (roomState) => setRoomPositionSeconds(roomState.positionSeconds),
    });
    client.connect();
    return () => client.disconnect();
  }, [user, value.room]);

  useEffect(() => {
    if (!hostWatching || roomPositionSeconds === null) return;
    const timer = setTimeout(() => onStart(roomPositionSeconds), AUTO_START_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hostWatching, onStart, roomPositionSeconds]);

  const guestDevices = Object.values(participants).filter(
    (participant) => participant.user.id === value.guest.id && participant.isPresent,
  );

  return (
    <SafeAreaView className="bg-background flex-1 px-5 py-4">
      <View className="flex-row justify-end">
        <Button size="sm" variant="ghost" onPress={onClose}>
          Leave
        </Button>
      </View>
      <View className="flex-1 items-center justify-center gap-6">
        {hostWatching ? <ActivityIndicator /> : null}
        <View className="items-center gap-2">
          <Text className="text-muted text-sm">{value.host.title} invited you to</Text>
          <Text className="text-center text-3xl font-bold">{value.item.title}</Text>
          <Text className="text-muted max-w-80 text-center text-sm leading-6">
            {hostWatching
              ? "The host started playback. Connecting your player…"
              : "You are in. Playback begins when the host presses Start."}
          </Text>
        </View>
        <View className="bg-surface w-full max-w-sm gap-3 rounded-3xl p-4">
          <Text className="font-semibold">Guest devices</Text>
          {(guestDevices.length > 0 ? guestDevices : [{ user, isPresent: true }]).map(
            (participant) => (
              <View
                key={participant.user.deviceIdentifier}
                className="flex-row items-center gap-3 rounded-2xl border border-white/10 p-3"
              >
                <View className="bg-accent size-2.5 rounded-full" />
                <Text className="flex-1" numberOfLines={1}>
                  {participant.user.deviceIdentifier === user.deviceIdentifier
                    ? `${nickname.trim()} (You)`
                    : participant.user.deviceName.replace(/^Multiplex Guest ·\s*/, "") || "Guest"}
                </Text>
                <Text className="text-muted text-xs">In lobby</Text>
              </View>
            ),
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const INITIAL_PLAYER_STATE: SyncplayPlayerState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  canPlay: false,
  isLoading: true,
  error: null,
};

function GuestPlayer({
  value,
  user,
  startAtSeconds,
  waitingForNext,
  onEnded,
  onClose,
}: {
  value: GuestWatchTogetherBootstrapValue;
  user: SyncplayUser;
  startAtSeconds: number;
  waitingForNext: boolean;
  onEnded: () => void;
  onClose: () => void;
}) {
  const videoRef = useRef<Video>(null);
  const playbackSessionId = useRef(`guest-${Date.now().toString(36)}`);
  const stateRef = useRef<SyncplayPlayerState>(INITIAL_PLAYER_STATE);
  const controllerRef = useRef<SyncplaySessionController | null>(null);
  const lastPlayback = useRef<{ isPlaying: boolean; currentTime: number } | null>(null);
  const [offsetSeconds, setOffsetSeconds] = useState(startAtSeconds);
  const source = useMemo(
    () =>
      buildMobilePlaybackSource({
        item: value.item,
        serverUrl: value.serverUrl,
        authToken: value.authToken,
        clientIdentifier: user.deviceIdentifier,
        playbackSessionId: playbackSessionId.current,
        offsetSeconds,
      }),
    [offsetSeconds, user.deviceIdentifier, value],
  );

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
    const controller = new SyncplaySessionController({
      room: value.room,
      user,
      player: {
        getState: () => stateRef.current,
        play: async () => {
          if (!videoRef.current) return false;
          await videoRef.current.playAsync();
          return true;
        },
        pause: () => void videoRef.current?.pauseAsync(),
        seek,
      },
    });
    controller.connect();
    controllerRef.current = controller;
    return () => {
      controller.disconnect();
      controllerRef.current = null;
    };
  }, [seek, user, value.room]);

  useEffect(() => {
    const currentSource = source;
    const currentPlaybackSessionId = playbackSessionId.current;
    return () => {
      if (currentSource?.transcodeSessionKey) {
        void stopMobileTranscode({
          serverUrl: value.serverUrl,
          authToken: value.authToken,
          clientIdentifier: user.deviceIdentifier,
          playbackSessionId: currentPlaybackSessionId,
          transcodeSessionKey: currentSource.transcodeSessionKey,
        });
      }
    };
  }, [source, user.deviceIdentifier, value.authToken, value.serverUrl]);

  const onPlaybackStatusUpdate = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) {
        stateRef.current = { ...stateRef.current, isLoading: true, error: status.error ?? null };
        return;
      }
      const sourceOffset = source?.usesTranscode ? offsetSeconds : 0;
      const currentTime = sourceOffset + status.positionMillis / 1_000;
      const duration = sourceOffset + (status.durationMillis ?? 0) / 1_000;
      stateRef.current = {
        isPlaying: status.isPlaying,
        currentTime,
        duration,
        canPlay: true,
        isLoading: status.isBuffering,
        error: null,
      };
      controllerRef.current?.setReady(true);
      const previous = lastPlayback.current;
      if (previous && previous.isPlaying !== status.isPlaying && !status.isBuffering) {
        controllerRef.current?.handleLocalPlaybackChange(!status.isPlaying);
      }
      if (previous && Math.abs(currentTime - previous.currentTime) > 3) {
        controllerRef.current?.handleLocalSeeked(currentTime);
      }
      lastPlayback.current = { isPlaying: status.isPlaying, currentTime };
      if (status.didJustFinish) onEnded();
    },
    [offsetSeconds, onEnded, source?.usesTranscode],
  );

  if (!source) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-black px-8">
        <Text className="text-center text-white">This guest stream is unavailable.</Text>
        <Button variant="secondary" onPress={onClose}>
          Leave
        </Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="flex-row justify-end px-4 py-2">
        <Button size="sm" variant="ghost" onPress={onClose}>
          Leave
        </Button>
      </View>
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
          progressUpdateIntervalMillis={500}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
        />
      </View>
      <View className="gap-2 px-4 pb-5">
        <Text className="text-lg font-semibold text-white" numberOfLines={1}>
          {value.item.title}
        </Text>
        <Text className="text-xs text-white/60">
          {waitingForNext ? "Waiting for the host's next episode…" : "Guest sync is active"}
        </Text>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => void videoRef.current?.presentFullscreenPlayer()}
        >
          Full screen
        </Button>
      </View>
    </SafeAreaView>
  );
}
