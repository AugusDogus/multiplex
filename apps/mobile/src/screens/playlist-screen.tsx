import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useState } from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { Input } from "heroui-native/input";
import { toast } from "sonner-native";

import { api } from "~/api";
import { ErrorState, LoadingState } from "~/components/query-state";
import { Screen } from "~/components/screen";
import { Text } from "~/components/text";
import type { RootStackParamList } from "~/navigation/types";

const PAGE_SIZE = 50;

export function PlaylistScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "Playlist">>();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { serverId, playlistRatingKey } = route.params;
  const input = { serverId, playlistRatingKey };
  const [start, setStart] = useState(0);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nextTitle, setNextTitle] = useState(route.params.title);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const playlist = api.plex.getPlaylist.useQuery(input);
  const contents = api.plex.getPlaylistContents.useQuery({
    ...input,
    start,
    size: PAGE_SIZE,
  });
  const utils = api.useUtils();
  const invalidate = () =>
    Promise.all([
      utils.plex.getPlaylist.invalidate(input),
      utils.plex.getPlaylistContents.invalidate(),
      utils.plex.getLibraryPlaylists.invalidate(),
    ]);
  const rename = api.plex.renamePlaylist.useMutation({
    onSuccess: async () => {
      await invalidate();
      setRenameOpen(false);
      toast.success("Playlist renamed");
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = api.plex.deletePlaylist.useMutation({
    onSuccess: async () => {
      await invalidate();
      setDeleteOpen(false);
      navigation.goBack();
    },
    onError: (error) => toast.error(error.message),
  });
  const move = api.plex.movePlaylistItem.useMutation({
    onSuccess: () => void contents.refetch(),
    onError: (error) => toast.error(error.message),
  });

  if (playlist.isPending || contents.isPending) {
    return (
      <Screen>
        <LoadingState label="Loading playlist…" />
      </Screen>
    );
  }
  if (playlist.isError || contents.isError || !playlist.data) {
    return (
      <Screen>
        <ErrorState
          onRetry={() => {
            void playlist.refetch();
            void contents.refetch();
          }}
        />
      </Screen>
    );
  }

  const editable = !playlist.data.readOnly;
  return (
    <Screen
      title={playlist.data.title}
      subtitle={`${contents.data.totalSize} ${contents.data.totalSize === 1 ? "item" : "items"}`}
    >
      {editable ? (
        <View className="flex-row gap-2">
          <Button size="sm" variant="secondary" onPress={() => setRenameOpen(true)}>
            Rename
          </Button>
          <Button size="sm" variant="danger" onPress={() => setDeleteOpen(true)}>
            Delete
          </Button>
        </View>
      ) : (
        <Text className="text-muted text-sm">This smart or shared playlist is read-only.</Text>
      )}

      <View className="gap-2">
        {contents.data.items.map((item, index) => {
          const playlistItemId = item.playlistItemID;
          return (
            <Pressable
              key={item.playlistItemID ?? `${item.ratingKey}-${index}`}
              className="bg-surface flex-row items-center gap-3 rounded-2xl p-3 active:scale-[0.98]"
              onPress={() =>
                navigation.navigate("Details", {
                  serverId,
                  ratingKey: item.ratingKey,
                })
              }
            >
              <View className="bg-default size-9 items-center justify-center rounded-xl">
                <Text className="text-muted text-xs font-semibold">{start + index + 1}</Text>
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-semibold" numberOfLines={1}>
                  {item.title}
                </Text>
                <Text className="text-muted text-xs" numberOfLines={1}>
                  {item.grandparentTitle ?? item.parentTitle ?? item.type}
                </Text>
              </View>
              {editable && playlistItemId ? (
                <View className="flex-row">
                  <Pressable
                    className="p-2 active:scale-90"
                    disabled={index === 0 || move.isPending}
                    onPress={(event) => {
                      event.stopPropagation();
                      move.mutate({ ...input, playlistItemId, direction: "up" });
                    }}
                  >
                    <Ionicons name="chevron-up" size={18} color={index === 0 ? "#555" : "#aaa"} />
                  </Pressable>
                  <Pressable
                    className="p-2 active:scale-90"
                    disabled={index === contents.data.items.length - 1 || move.isPending}
                    onPress={(event) => {
                      event.stopPropagation();
                      move.mutate({ ...input, playlistItemId, direction: "down" });
                    }}
                  >
                    <Ionicons
                      name="chevron-down"
                      size={18}
                      color={index === contents.data.items.length - 1 ? "#555" : "#aaa"}
                    />
                  </Pressable>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View className="flex-row justify-between">
        <Button
          size="sm"
          variant="secondary"
          isDisabled={start === 0}
          onPress={() => setStart((value) => Math.max(0, value - PAGE_SIZE))}
        >
          Previous
        </Button>
        <Button
          size="sm"
          variant="secondary"
          isDisabled={start + PAGE_SIZE >= contents.data.totalSize}
          onPress={() => setStart((value) => value + PAGE_SIZE)}
        >
          Next
        </Button>
      </View>

      <Dialog isOpen={renameOpen} onOpenChange={setRenameOpen}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Rename playlist</Dialog.Title>
            <View className="gap-4 pt-4">
              <Input value={nextTitle} onChangeText={setNextTitle} />
              <Button
                isDisabled={!nextTitle.trim() || rename.isPending}
                onPress={() => rename.mutate({ ...input, title: nextTitle.trim() })}
              >
                Save
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>

      <Dialog isOpen={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Delete playlist?</Dialog.Title>
            <Dialog.Description>
              This removes the playlist from Plex. The media files stay intact.
            </Dialog.Description>
            <View className="flex-row justify-end gap-2 pt-4">
              <Button variant="secondary" onPress={() => setDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                isDisabled={remove.isPending}
                onPress={() => remove.mutate(input)}
              >
                Delete
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </Screen>
  );
}
