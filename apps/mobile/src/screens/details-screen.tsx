import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import {
  getMainTitle,
  getMetadataTypeLabel,
  getPlayButtonLabel,
  getPlaylistTypeForItemType,
  getPlexImagePath,
  getPosterImagePath,
} from "@multiplex/plex-query";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { Input } from "heroui-native/input";
import { toast } from "sonner-native";

import { api, type RouterOutputs } from "~/api";
import { ErrorState, LoadingState } from "~/components/query-state";
import { Screen } from "~/components/screen";
import { Text } from "~/components/text";
import type { RootStackParamList } from "~/navigation/types";
import { storeGuestHostCapability } from "~/lib/guest-host-capability";

export function DetailsScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Details">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const utils = api.useUtils();
  const details = api.plex.getItemDetails.useQuery({
    serverId: route.params.serverId,
    ratingKey: route.params.ratingKey,
  });
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [guestLinkOpen, setGuestLinkOpen] = useState(false);

  if (details.isPending) {
    return (
      <Screen>
        <LoadingState label="Loading details…" />
      </Screen>
    );
  }
  if (details.isError || !details.data) {
    return (
      <Screen>
        <ErrorState
          message="This item is no longer available from its Plex server."
          onRetry={() => void details.refetch()}
        />
      </Screen>
    );
  }

  const value = details.data;
  const item = value.item;
  const posterUrl = getPlexImagePath(getPosterImagePath(item), {
    width: 440,
    height: 660,
    serverUrl: value.serverUrl,
    authToken: value.authToken,
  });
  const watched = Boolean(item.viewCount);
  const canPlay = Boolean(value.playTarget && value.serverUrl && value.authToken);

  return (
    <Screen>
      <View className="flex-row gap-4">
        <View className="bg-default aspect-[2/3] w-32 overflow-hidden rounded-2xl">
          {posterUrl ? (
            <Image
              source={{ uri: posterUrl }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
            />
          ) : (
            <View className="flex-1 items-center justify-center">
              <Ionicons name="film-outline" size={30} color="#888" />
            </View>
          )}
        </View>
        <View className="flex-1 justify-center gap-2">
          <Text className="text-muted text-xs font-semibold tracking-wider uppercase">
            {getMetadataTypeLabel(item.type)} · {value.serverName ?? "Plex"}
          </Text>
          <Text className="text-2xl font-bold tracking-tight">{getMainTitle(item)}</Text>
          <Text className="text-muted text-sm">
            {[item.year, item.contentRating, item.studio].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        <Button
          className="flex-1 active:scale-[0.97]"
          isDisabled={!canPlay}
          onPress={() => {
            const target = value.playTarget;
            if (!target) return;
            navigation.navigate("Player", {
              serverId: route.params.serverId,
              ratingKey: target.ratingKey,
              startAtSeconds: target.viewOffset ? target.viewOffset / 1_000 : undefined,
            });
          }}
        >
          {getPlayButtonLabel(value.playTarget)}
        </Button>
        <WatchedButton
          serverId={route.params.serverId}
          ratingKey={item.ratingKey}
          watched={watched}
        />
        <Button variant="secondary" onPress={() => setPlaylistOpen(true)}>
          Playlist
        </Button>
        <Button
          variant="secondary"
          isDisabled={!canPlay}
          onPress={async () => {
            const target = value.playTarget;
            if (!target) return;
            const room = await utils.client.plex.createWatchTogetherRoom.mutate({
              serverId: route.params.serverId,
              ratingKey: target.ratingKey,
              key: target.key,
              title: item.title,
              users: [],
            });
            navigation.navigate("WatchTogetherRoom", { roomId: room.id });
          }}
        >
          Together
        </Button>
        <Button variant="secondary" isDisabled={!canPlay} onPress={() => setGuestLinkOpen(true)}>
          Guest link
        </Button>
      </View>

      {item.summary ? (
        <Text className="text-muted text-[15px] leading-6">{item.summary}</Text>
      ) : null}

      {value.children.length > 0 ? (
        <View className="gap-3">
          <Text className="text-xl font-bold">{item.type === "show" ? "Seasons" : "Episodes"}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-3"
          >
            {value.children.map((child) => (
              <Pressable
                key={child.ratingKey}
                className="bg-surface w-44 gap-2 rounded-2xl p-3 active:scale-[0.97]"
                onPress={() =>
                  navigation.push("Details", {
                    serverId: route.params.serverId,
                    ratingKey: child.ratingKey,
                  })
                }
              >
                <Text className="font-semibold" numberOfLines={2}>
                  {child.title}
                </Text>
                <Text className="text-muted text-xs" numberOfLines={2}>
                  {child.summary ?? `${child.leafCount ?? 0} items`}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {item.Role?.length ? (
        <View className="gap-3">
          <Text className="text-xl font-bold">Cast & crew</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-3"
          >
            {item.Role.slice(0, 18).map((role) => {
              const imageUrl = getPlexImagePath(role.thumb, {
                width: 160,
                height: 160,
                serverUrl: value.serverUrl,
                authToken: value.authToken,
              });
              return (
                <View
                  key={`${role.tag}-${role.role ?? "role"}`}
                  className="w-24 items-center gap-2"
                >
                  <View className="bg-default size-20 overflow-hidden rounded-full">
                    {imageUrl ? (
                      <Image
                        source={{ uri: imageUrl }}
                        style={{ width: 80, height: 80 }}
                        contentFit="cover"
                      />
                    ) : null}
                  </View>
                  <Text className="text-center text-xs font-semibold" numberOfLines={2}>
                    {role.tag}
                  </Text>
                  {role.role ? (
                    <Text className="text-muted text-center text-[11px]" numberOfLines={2}>
                      {role.role}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      <PlaylistDialog
        open={playlistOpen}
        onOpenChange={setPlaylistOpen}
        serverId={route.params.serverId}
        item={item}
      />
      {value.playTarget ? (
        <GuestLinkDialog
          open={guestLinkOpen}
          onOpenChange={setGuestLinkOpen}
          serverId={route.params.serverId}
          item={value.playTarget}
          onCreated={async (roomId, capability) => {
            await storeGuestHostCapability(roomId, capability);
            setGuestLinkOpen(false);
            navigation.navigate("WatchTogetherRoom", { roomId });
          }}
        />
      ) : null}
    </Screen>
  );
}

function GuestLinkDialog({
  open,
  onOpenChange,
  serverId,
  item,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  item: NonNullable<NonNullable<RouterOutputs["plex"]["getItemDetails"]>["playTarget"]>;
  onCreated: (roomId: string, capability: string) => Promise<void>;
}) {
  const [confirmEnable, setConfirmEnable] = useState(false);
  const eligibility = api.guestWatchTogether.eligibility.useQuery(
    { serverId, ratingKey: item.ratingKey },
    { enabled: open, retry: false },
  );
  const enableGuest = api.guestWatchTogether.enableGuest.useMutation({
    onSuccess: async (result) => {
      if (result.status !== "ready") {
        toast.error("Plex could not enable the Guest profile");
        return;
      }
      setConfirmEnable(false);
      toast.success("Plex Home Guest enabled");
      await eligibility.refetch();
    },
    onError: (error) => toast.error(error.message),
  });
  const createLink = api.guestWatchTogether.createLink.useMutation({
    onSuccess: async (result) => {
      await onCreated(result.room.id, result.capability);
      toast.success("Trusted Guest link created");
    },
    onError: (error) => toast.error(error.message),
  });
  const status = eligibility.data;
  const pending = eligibility.isPending || enableGuest.isPending || createLink.isPending;

  const unavailableCopy = (() => {
    if (status?.status !== "unavailable") return null;
    switch (status.reason) {
      case "guest-protected":
        return "Remove the Guest PIN in Plex before creating a link.";
      case "not-home-member":
        return "Only an eligible member of this Plex Home can use its Guest profile.";
      case "server-unavailable":
        return "Give the Guest profile access to this server and its libraries in Plex.";
      case "item-unavailable":
        return "Adjust the Guest profile's library or content restrictions in Plex.";
      case "guest-switch-failed":
      case "plex-unavailable":
      case "guest-disabled":
        return "Guest access could not be verified. Check Plex and try again.";
      default: {
        const exhaustive: never = status.reason;
        return exhaustive;
      }
    }
  })();

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Create a guest link</Dialog.Title>
          <Dialog.Description>
            Anyone with the link temporarily receives the Plex Home Guest profile's library access.
          </Dialog.Description>
          <View className="gap-4 pt-4">
            {eligibility.isPending ? (
              <LoadingState label="Checking Plex Guest access…" />
            ) : status?.status === "ready" ? (
              <View className="bg-surface gap-2 rounded-2xl p-4">
                <Text className="font-semibold">Guest access is ready</Text>
                <Text className="text-muted text-sm">
                  The host starts playback manually. Share the link only with people you trust.
                </Text>
              </View>
            ) : status?.status === "unavailable" &&
              status.reason === "guest-disabled" &&
              status.canEnableGuest ? (
              <View className="gap-3">
                <Text className="text-muted text-sm">
                  Enable the built-in Plex Home Guest profile before creating a shareable link.
                </Text>
                {confirmEnable ? (
                  <View className="gap-3 rounded-2xl border border-amber-500/30 p-4">
                    <Text className="text-sm">
                      Plex may create a Plex Home and disable DLNA by default. You still control
                      Guest library access in Plex.
                    </Text>
                    <View className="flex-row gap-2">
                      <Button size="sm" variant="ghost" onPress={() => setConfirmEnable(false)}>
                        Back
                      </Button>
                      <Button
                        size="sm"
                        isDisabled={enableGuest.isPending}
                        onPress={() => enableGuest.mutate()}
                      >
                        Enable Guest
                      </Button>
                    </View>
                  </View>
                ) : (
                  <Button variant="secondary" onPress={() => setConfirmEnable(true)}>
                    Review and enable
                  </Button>
                )}
              </View>
            ) : (
              <View className="gap-3">
                <Text className="text-muted text-sm">{unavailableCopy}</Text>
                <View className="flex-row gap-2">
                  <Button size="sm" variant="secondary" onPress={() => void eligibility.refetch()}>
                    Check again
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() =>
                      void Linking.openURL("https://app.plex.tv/desktop/#!/settings/plex-home")
                    }
                  >
                    Plex settings
                  </Button>
                </View>
              </View>
            )}
            <View className="flex-row justify-end gap-2">
              <Button variant="ghost" isDisabled={pending} onPress={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                isDisabled={status?.status !== "ready" || pending}
                onPress={() =>
                  createLink.mutate({
                    serverId,
                    ratingKey: item.ratingKey,
                    key: item.key,
                    title: item.title,
                  })
                }
              >
                {createLink.isPending ? "Creating…" : "Create link"}
              </Button>
            </View>
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}

function WatchedButton({
  serverId,
  ratingKey,
  watched,
}: {
  serverId: string;
  ratingKey: string;
  watched: boolean;
}) {
  const utils = api.useUtils();
  const mutation = api.plex.setItemWatchedState.useMutation({
    onSuccess: () => {
      void utils.plex.getItemDetails.invalidate({ serverId, ratingKey });
      void utils.plex.getAllContinueWatching.invalidate();
    },
  });
  return (
    <Button
      variant="secondary"
      isDisabled={mutation.isPending}
      onPress={() => mutation.mutate({ serverId, ratingKey, watched: !watched })}
    >
      {watched ? "Unwatch" : "Watched"}
    </Button>
  );
}

function PlaylistDialog({
  open,
  onOpenChange,
  serverId,
  item,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serverId: string;
  item: NonNullable<RouterOutputs["plex"]["getItemDetails"]>["item"];
}) {
  const [title, setTitle] = useState("");
  const playlistType = getPlaylistTypeForItemType(item.type);
  const playlists = api.plex.getItemPlaylists.useQuery(
    { serverId, playlistType },
    { enabled: open },
  );
  const add = api.plex.addItemToPlaylist.useMutation({
    onSuccess: () => {
      toast.success("Added to playlist");
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message),
  });
  const create = api.plex.createPlaylistWithItem.useMutation({
    onSuccess: (result) => {
      toast.success(`Created ${result.title}`);
      setTitle("");
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Dialog isOpen={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Title>Add to playlist</Dialog.Title>
          <Dialog.Description>{item.title}</Dialog.Description>
          <View className="gap-3 pt-4">
            <Input placeholder="New playlist name" value={title} onChangeText={setTitle} />
            <Button
              size="sm"
              isDisabled={!title.trim() || create.isPending}
              onPress={() =>
                create.mutate({
                  serverId,
                  title: title.trim(),
                  type: playlistType,
                  ratingKey: item.ratingKey,
                  key: item.key,
                })
              }
            >
              Create playlist
            </Button>
            {(playlists.data ?? []).map((playlist) => (
              <Button
                key={playlist.ratingKey}
                variant="secondary"
                isDisabled={add.isPending}
                onPress={() =>
                  add.mutate({
                    serverId,
                    playlistRatingKey: playlist.ratingKey,
                    playlistTitle: playlist.title,
                    ratingKey: item.ratingKey,
                    key: item.key,
                  })
                }
              >
                {playlist.title} · {playlist.leafCount}
              </Button>
            ))}
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
}
