"use client";

import { useState, type ReactNode } from "react";
import { Loader2, ListPlus, Plus } from "lucide-react";
import { getPlaylistTypeForItemType } from "@multiplex/plex-query";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";

import type { ItemDetails } from "./types";

interface AddToPlaylistDialogProps {
  item: ItemDetails["item"];
  serverId: string;
  serverUrl: string;
  authToken: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFeedback: (message: string) => void;
}

export function AddToPlaylistDialog({
  item,
  serverId,
  serverUrl,
  authToken,
  open,
  onOpenChange,
  onFeedback,
}: AddToPlaylistDialogProps) {
  const utils = api.useUtils();
  const playlistType = getPlaylistTypeForItemType(item.type);
  const [newTitle, setNewTitle] = useState("");

  const playlistsQuery = api.plex.getItemPlaylists.useQuery(
    { serverId, serverUrl, authToken, playlistType },
    { enabled: open, staleTime: 30_000 },
  );

  const invalidatePlaylists = () =>
    utils.plex.getItemPlaylists.invalidate({
      serverId,
      serverUrl,
      authToken,
      playlistType,
    });

  const addMutation = api.plex.addItemToPlaylist.useMutation({
    onSuccess: (_result, variables) => {
      void invalidatePlaylists();
      onFeedback(`Added to ${variables.playlistTitle}`);
      onOpenChange(false);
    },
    onError: (error) => onFeedback(error.message),
  });

  const createMutation = api.plex.createPlaylistWithItem.useMutation({
    onSuccess: (result) => {
      void invalidatePlaylists();
      onFeedback(`Created playlist "${result.title}"`);
      setNewTitle("");
      onOpenChange(false);
    },
    onError: (error) => onFeedback(error.message),
  });

  const isBusy = addMutation.isPending || createMutation.isPending;
  const pendingPlaylistKey = addMutation.isPending
    ? addMutation.variables?.playlistRatingKey
    : undefined;

  const addToPlaylist = (playlistRatingKey: string, playlistTitle: string) => {
    if (isBusy) {
      return;
    }

    addMutation.mutate({
      serverId,
      serverUrl,
      authToken,
      playlistRatingKey,
      playlistTitle,
      ratingKey: item.ratingKey,
      key: item.key,
    });
  };

  const createPlaylist = () => {
    const title = newTitle.trim();
    if (!title || isBusy) {
      return;
    }

    createMutation.mutate({
      serverId,
      serverUrl,
      authToken,
      title,
      type: playlistType,
      ratingKey: item.ratingKey,
      key: item.key,
    });
  };

  const playlists = playlistsQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to playlist</DialogTitle>
          <DialogDescription className="line-clamp-1">
            {item.title}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              createPlaylist();
            }}
          >
            <Input
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              placeholder="New playlist name"
              maxLength={255}
              aria-label="New playlist name"
              disabled={isBusy}
            />
            <Button type="submit" disabled={!newTitle.trim() || isBusy}>
              {createMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Plus data-icon="inline-start" />
              )}
              Create
            </Button>
          </form>

          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {playlistsQuery.isPending ? (
              <PlaylistStatus>
                <Loader2 className="size-4 animate-spin" /> Loading playlists…
              </PlaylistStatus>
            ) : playlistsQuery.isError ? (
              <PlaylistStatus>Could not load playlists.</PlaylistStatus>
            ) : playlists.length === 0 ? (
              <PlaylistStatus>
                No playlists yet. Create one above.
              </PlaylistStatus>
            ) : (
              playlists.map((playlist) => (
                <button
                  key={playlist.ratingKey}
                  type="button"
                  onClick={() =>
                    addToPlaylist(playlist.ratingKey, playlist.title)
                  }
                  disabled={isBusy}
                  className="hover:bg-accent focus-visible:bg-accent flex items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors outline-none disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    {pendingPlaylistKey === playlist.ratingKey ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ListPlus className="text-muted-foreground size-4" />
                    )}
                    <span className="line-clamp-1">{playlist.title}</span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {playlist.leafCount} item
                    {playlist.leafCount === 1 ? "" : "s"}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PlaylistStatus({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 px-3 py-6 text-sm">
      {children}
    </div>
  );
}
