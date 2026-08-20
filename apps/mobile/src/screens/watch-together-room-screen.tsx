import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Share, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import {
  allInvitedPresent,
  AUTO_START_DELAY_MS,
  getParticipantStatus,
  isSoloRoom,
  mergeParticipantState,
  MULTIPLEX_SYNCPLAY_DEVICE_NAME,
  parseLibraryItemUri,
  participantsByUserId,
  SyncplayClient,
  type ParticipantMap,
} from "@multiplex/plex-query";
import { Button } from "heroui-native/button";
import { toast } from "sonner-native";

import { api } from "~/api";
import { ErrorState, LoadingState } from "~/components/query-state";
import { Screen } from "~/components/screen";
import { Text } from "~/components/text";
import type { RootStackParamList } from "~/navigation/types";
import { readGuestHostCapability } from "~/lib/guest-host-capability";
import { getBaseUrl } from "~/lib/base-url";

export function WatchTogetherRoomScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "WatchTogetherRoom">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const room = api.plex.getWatchTogetherRoom.useQuery(
    { roomId: route.params.roomId },
    { refetchInterval: 3_000 },
  );
  const invitees = api.plex.getWatchTogetherInvitees.useQuery();
  const localUser = api.plex.getUserInfo.useQuery();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [participants, setParticipants] = useState<ParticipantMap>({});
  const [roomPositionSeconds, setRoomPositionSeconds] = useState<number | null>(null);
  const [guestCapability, setGuestCapability] = useState<string | null>(null);
  const [guestCapabilityLoaded, setGuestCapabilityLoaded] = useState(false);
  const deviceIdentifier = useRef(
    `mobile-lobby-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );
  const autoStarted = useRef(false);
  const utils = api.useUtils();
  const invite = api.plex.inviteWatchTogetherUsers.useMutation({
    onSuccess: async () => {
      setSelected(new Set());
      await utils.plex.getWatchTogetherRoom.invalidate({ roomId: route.params.roomId });
      toast.success("Invitations sent");
    },
    onError: (error) => toast.error(error.message),
  });
  const availableInvitees = useMemo(() => {
    const memberIds = new Set(room.data?.users.map((user) => user.id) ?? []);
    return (invitees.data ?? []).filter((user) => !memberIds.has(user.id));
  }, [invitees.data, room.data?.users]);

  useEffect(() => {
    let active = true;
    void readGuestHostCapability(route.params.roomId).then(
      (capability) => {
        if (active) {
          setGuestCapability(capability);
          setGuestCapabilityLoaded(true);
        }
      },
      () => {
        if (active) setGuestCapabilityLoaded(true);
      },
    );
    return () => {
      active = false;
    };
  }, [route.params.roomId]);

  useEffect(() => {
    if (!room.data || !localUser.data) return;
    const client = new SyncplayClient({
      room: room.data,
      user: {
        id: localUser.data.id,
        deviceIdentifier: deviceIdentifier.current,
        deviceName: MULTIPLEX_SYNCPLAY_DEVICE_NAME,
      },
      observer: true,
      onParticipant: (participant) =>
        setParticipants((current) => mergeParticipantState(current, participant)),
      onRoomState: (state) => setRoomPositionSeconds(state.positionSeconds),
    });
    client.connect();
    client.setReady(null);
    return () => client.disconnect();
  }, [localUser.data, room.data]);

  useEffect(() => {
    if (
      !room.data ||
      !localUser.data ||
      !guestCapabilityLoaded ||
      guestCapability ||
      autoStarted.current ||
      isSoloRoom(room.data) ||
      !allInvitedPresent(room.data, participants, localUser.data.id)
    ) {
      return;
    }
    const source = parseLibraryItemUri(room.data.sourceUri);
    if (!source) return;
    const timeout = setTimeout(() => {
      autoStarted.current = true;
      navigation.navigate("Player", {
        serverId: source.serverId,
        ratingKey: source.ratingKey,
        roomId: room.data.id,
        startAtSeconds: roomPositionSeconds ?? undefined,
      });
    }, AUTO_START_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [
    guestCapability,
    guestCapabilityLoaded,
    localUser.data,
    navigation,
    participants,
    room.data,
    roomPositionSeconds,
  ]);

  if (room.isPending)
    return (
      <Screen>
        <LoadingState label="Joining room…" />
      </Screen>
    );
  if (room.isError)
    return (
      <Screen>
        <ErrorState message={room.error.message} onRetry={() => void room.refetch()} />
      </Screen>
    );

  const source = parseLibraryItemUri(room.data.sourceUri);
  const participantsById = participantsByUserId(participants);
  return (
    <Screen title={room.data.title} subtitle="Everyone in this room stays in sync.">
      <View className="bg-surface gap-3 rounded-3xl p-5">
        <Text className="text-lg font-bold">Participants</Text>
        {room.data.users.map((user) => (
          <View key={user.id} className="flex-row items-center justify-between">
            <Text>{user.title ?? user.username}</Text>
            <Text className="text-muted text-xs capitalize">
              {getParticipantStatus(
                participantsById.get(user.id),
                user.id === localUser.data?.id,
              ).replace("inLobby", "in lobby")}
            </Text>
          </View>
        ))}
      </View>

      {source ? (
        <Button
          className="active:scale-[0.97]"
          onPress={() =>
            navigation.navigate("Player", {
              serverId: source.serverId,
              ratingKey: source.ratingKey,
              roomId: room.data.id,
            })
          }
        >
          Start or join playback
        </Button>
      ) : null}

      {guestCapability ? (
        <Button
          variant="secondary"
          onPress={() =>
            void Share.share({
              title: `Join ${room.data.title} on Multiplex`,
              message: `${getBaseUrl()}/watch-together/guest/${encodeURIComponent(guestCapability)}`,
            })
          }
        >
          Share guest link
        </Button>
      ) : null}

      {availableInvitees.length > 0 ? (
        <View className="gap-3">
          <Text className="text-xl font-bold">Invite friends</Text>
          {availableInvitees.map((user) => (
            <Pressable
              key={user.id}
              className={`flex-row items-center justify-between rounded-2xl p-4 active:scale-[0.98] ${selected.has(user.id) ? "bg-accent" : "bg-surface"}`}
              onPress={() =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (next.has(user.id)) next.delete(user.id);
                  else next.add(user.id);
                  return next;
                })
              }
            >
              <Text className="font-semibold">{user.title}</Text>
              <Text className="text-muted text-xs">
                {selected.has(user.id) ? "Selected" : "Invite"}
              </Text>
            </Pressable>
          ))}
          <Button
            isDisabled={selected.size === 0 || invite.isPending}
            onPress={() => invite.mutate({ roomId: room.data.id, users: [...selected] })}
          >
            Send invitations
          </Button>
        </View>
      ) : null}
    </Screen>
  );
}
