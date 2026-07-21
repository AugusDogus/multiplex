"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Loader2,
  Lock,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { getPlexImagePath } from "~/lib/plex-image";
import { getItemDetailsHref, getLibraryPivotHref } from "~/lib/plex-routes";
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
      toast.success(`Renamed playlist to “${variables.title}”`);
    },
    onError: () => toast.error("Couldn't rename the playlist"),
  });

  const deleteMutation = api.plex.deletePlaylist.useMutation({
    onSuccess: async () => {
      await invalidatePlaylistData();
      setDeleteOpen(false);
      toast.success("Playlist deleted");
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
    onError: () => toast.error("Couldn't delete the playlist"),
  });

  const moveMutation = api.plex.movePlaylistItem.useMutation({
    onSuccess: async () => {
      await invalidatePlaylistData();
    },
    onError: () => {
      toast.error("Couldn't reorder the playlist");
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
      <section className="flex flex-col gap-4 rounded-xl border p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-2xl font-semibold">
                {playlist.title}
              </h1>
              {playlist.readOnly && (
                <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                  <Lock className="size-3" /> Read-only
                </span>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {totalSize} item{totalSize === 1 ? "" : "s"}
              {playlist.smart ? " · Smart playlist" : ""}
            </p>
          </div>

          <Button
            type="button"
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={!editable || busy}
          >
            <Trash2 /> Delete playlist
          </Button>
        </div>

        <form
          className="flex max-w-xl flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            submitRename();
          }}
        >
          <Input
            value={renameTitle}
            onChange={(event) => setRenameTitle(event.target.value)}
            placeholder={playlist.title}
            aria-label="New playlist name"
            maxLength={255}
            disabled={!editable || busy}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={
              !editable ||
              busy ||
              normalizedRenameTitle.length === 0 ||
              normalizedRenameTitle === playlist.title
            }
          >
            {renameMutation.isPending ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Pencil />
            )}
            Rename
          </Button>
        </form>
      </section>

      <section aria-label="Playlist contents" className="flex flex-col gap-2">
        {contentsQuery.isError ? (
          <div className="rounded-lg border p-6 text-sm">
            <p className="text-destructive">Could not load playlist items.</p>
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => void contentsQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border p-6 text-sm">
            This playlist is empty.
          </p>
        ) : (
          items.map((item, index) => {
            const thumbnailUrl = getPlexImagePath(item.thumb, {
              width: 96,
              height: 144,
              serverUrl: serverConnection?.serverUrl,
              authToken: serverConnection?.authToken,
            });
            const canReorder = editable && item.playlistItemID !== undefined;

            return (
              <article
                key={item.playlistItemID ?? `${item.ratingKey}-${index}`}
                className="bg-card flex items-center gap-3 rounded-lg border p-3"
              >
                {thumbnailUrl ? (
                  <Image
                    src={thumbnailUrl}
                    alt=""
                    width={48}
                    height={72}
                    className="h-14 w-10 rounded object-cover"
                  />
                ) : (
                  <div className="bg-muted h-14 w-10 shrink-0 rounded" />
                )}

                <div className="min-w-0 flex-1">
                  <Link
                    href={getItemDetailsHref(
                      serverId,
                      item.type,
                      item.ratingKey,
                    )}
                    className="hover:underline"
                  >
                    <span className="line-clamp-1 font-medium">
                      {item.title}
                    </span>
                  </Link>
                  <p className="text-muted-foreground line-clamp-1 text-xs">
                    {item.grandparentTitle ?? item.parentTitle ?? item.type}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Move ${item.title} up`}
                    onClick={() => moveItem(index, "up")}
                    disabled={!canReorder || busy || start + index === 0}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Move ${item.title} down`}
                    onClick={() => moveItem(index, "down")}
                    disabled={
                      !canReorder || busy || start + index >= totalSize - 1
                    }
                  >
                    <ArrowDown />
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </section>

      {totalSize > PAGE_SIZE && (
        <nav aria-label="Playlist pages" className="flex justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={start === 0 || contentsQuery.isFetching}
            onClick={() => setStart((value) => Math.max(0, value - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={
              start + PAGE_SIZE >= totalSize || contentsQuery.isFetching
            }
            onClick={() => setStart((value) => value + PAGE_SIZE)}
          >
            Next
          </Button>
        </nav>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{playlist.title}”?</DialogTitle>
            <DialogDescription>
              This permanently deletes the entire playlist. Your media files are
              not deleted.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => deleteMutation.mutate(playlistInput)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin" />}
              Delete playlist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
