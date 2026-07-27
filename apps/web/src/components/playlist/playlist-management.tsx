"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { PlaylistDeleteDialog } from "~/components/playlist/playlist-delete-dialog";
import { PlaylistItemsSection } from "~/components/playlist/playlist-items-section";
import { PlaylistManagementHeader } from "~/components/playlist/playlist-management-header";
import { toastManager } from "~/components/ui/toast-manager";
import { getLibraryPivotHref } from "~/lib/plex-routes";
import {
  resolveServerCredentials,
  useSyncedPlaylist,
  useSyncedPlaylistContents,
} from "~/lib/sync-engine";
import { api } from "~/trpc/api";

const PAGE_SIZE = 50;

interface PlaylistManagementProps {
  serverId: string;
  playlistRatingKey: string;
  librarySectionId?: string;
}

export function PlaylistManagement({
  serverId,
  playlistRatingKey,
  librarySectionId,
}: PlaylistManagementProps) {
  const router = useRouter();
  const utils = api.useUtils();
  const [start, setStart] = useState(0);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const playlistInput = { serverId, playlistRatingKey };
  const playlistQuery = useSyncedPlaylist(serverId, playlistRatingKey);
  const contentsQuery = useSyncedPlaylistContents({
    ...playlistInput,
    start,
    size: PAGE_SIZE,
  });

  const invalidatePlaylistData = async () => {
    await Promise.all([
      playlistQuery.refetch(),
      contentsQuery.refetch(),
      utils.plex.getItemPlaylists.invalidate(),
      utils.plex.getLibraryPlaylists.invalidate(),
    ]);
  };

  const renameMutation = api.plex.renamePlaylist.useMutation({
    onSuccess: async (_result, variables) => {
      await invalidatePlaylistData();
      setRenameTitle("");
      toastManager.add({
        title: `Renamed playlist to “${variables.title}”`,
        type: "success",
      });
    },
    onError: () =>
      toastManager.add({
        title: "Couldn't rename the playlist",
        type: "error",
      }),
  });

  const deleteMutation = api.plex.deletePlaylist.useMutation({
    onSuccess: async () => {
      await invalidatePlaylistData();
      setDeleteOpen(false);
      toastManager.add({
        title: "Playlist deleted",
        type: "success",
      });
      router.push(
        librarySectionId
          ? getLibraryPivotHref({
              machineIdentifier: serverId,
              sectionId: librarySectionId,
              pivot: "playlists",
            })
          : "/",
      );
    },
    onError: () =>
      toastManager.add({
        title: "Couldn't delete the playlist",
        type: "error",
      }),
  });

  const moveMutation = api.plex.movePlaylistItem.useMutation({
    onSuccess: async () => {
      await invalidatePlaylistData();
    },
    onError: () => {
      toastManager.add({
        title: "Couldn't reorder the playlist",
        type: "error",
      });
      void contentsQuery.refetch();
    },
  });

  if (playlistQuery.isPending || contentsQuery.isPending) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading playlist…
      </div>
    );
  }

  if (playlistQuery.isError || !playlistQuery.data) {
    return (
      <p className="text-destructive text-sm">Could not load this playlist.</p>
    );
  }

  const playlist = playlistQuery.data;
  const contents = contentsQuery.data;
  const items = contents?.items ?? [];
  const serverConnection = resolveServerCredentials(serverId);
  const totalSize = contents?.totalSize ?? playlist.leafCount;
  const editable = !playlist.readOnly;
  const normalizedRenameTitle = renameTitle.trim();
  const busy =
    renameMutation.isPending ||
    deleteMutation.isPending ||
    moveMutation.isPending;

  const submitRename = () => {
    if (
      !editable ||
      busy ||
      normalizedRenameTitle.length === 0 ||
      normalizedRenameTitle.length > 255 ||
      normalizedRenameTitle === playlist.title
    ) {
      return;
    }

    renameMutation.mutate({
      ...playlistInput,
      title: normalizedRenameTitle,
    });
  };

  const moveItem = (index: number, direction: "up" | "down") => {
    const item = items[index];
    if (!editable || busy || !item?.playlistItemID) {
      return;
    }

    moveMutation.mutate({
      ...playlistInput,
      playlistItemId: item.playlistItemID,
      direction,
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PlaylistManagementHeader
        playlist={playlist}
        totalSize={totalSize}
        editable={editable}
        busy={busy}
        renameTitle={renameTitle}
        renamePending={renameMutation.isPending}
        onRenameTitleChange={setRenameTitle}
        onSubmitRename={submitRename}
        onDeleteClick={() => setDeleteOpen(true)}
      />

      <PlaylistItemsSection
        items={items}
        serverId={serverId}
        serverUrl={serverConnection?.serverUrl}
        authToken={serverConnection?.authToken}
        start={start}
        totalSize={totalSize}
        pageSize={PAGE_SIZE}
        editable={editable}
        busy={busy}
        isError={contentsQuery.isError}
        isFetching={contentsQuery.isFetching}
        onRetry={() => void contentsQuery.refetch()}
        onMove={moveItem}
        onPreviousPage={() =>
          setStart((value) => Math.max(0, value - PAGE_SIZE))
        }
        onNextPage={() => setStart((value) => value + PAGE_SIZE)}
      />

      <PlaylistDeleteDialog
        open={deleteOpen}
        title={playlist.title}
        pending={deleteMutation.isPending}
        onOpenChange={setDeleteOpen}
        onConfirm={() => deleteMutation.mutate(playlistInput)}
      />
    </div>
  );
}
