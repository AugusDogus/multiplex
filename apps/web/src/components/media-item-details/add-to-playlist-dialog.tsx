"use client";

import { useState, type ReactNode } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
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
import { isAsyncResultLoading } from "~/lib/effect/async-result";
import {
  addItemToPlaylist,
  createPlaylistWithItem,
  itemPlaylistsAtom,
} from "~/lib/effect/plex-browse-atoms";
import { asCreatePlaylistResult } from "~/lib/effect/plex-boundary";
import { itemPlaylistsWriteKeysFor } from "~/lib/effect/reactivity-keys";

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
  const playlistType = getPlaylistTypeForItemType(item.type);
  const [newTitle, setNewTitle] = useState("");
  const [pendingPlaylistKey, setPendingPlaylistKey] = useState<string | null>(
    null,
  );
  const [isCreating, setIsCreating] = useState(false);

  const playlistsResult = useAtomValue(
    itemPlaylistsAtom({
      serverId,
      serverUrl,
      authToken,
      playlistType,
      enabled: open,
    }),
  );
  const playlists =
    Option.getOrUndefined(AsyncResult.value(playlistsResult)) ?? [];
  const isPlaylistsPending = isAsyncResultLoading(playlistsResult);
  const isPlaylistsError = AsyncResult.isFailure(playlistsResult);

  const addToPlaylistMutation = useAtomSet(addItemToPlaylist, {
    mode: "promiseExit",
  });
  const createPlaylistMutation = useAtomSet(createPlaylistWithItem, {
    mode: "promiseExit",
  });

  const isBusy = pendingPlaylistKey !== null || isCreating;
  const playlistWriteKeys = itemPlaylistsWriteKeysFor(serverId, playlistType);

  const addToPlaylist = (playlistRatingKey: string, playlistTitle: string) => {
    if (isBusy) {
      return;
    }

    setPendingPlaylistKey(playlistRatingKey);
    void (async () => {
      const exit = await addToPlaylistMutation({
        payload: {
          serverId,
          serverUrl,
          authToken,
          playlistRatingKey,
          playlistTitle,
          ratingKey: item.ratingKey,
          key: item.key,
        },
        reactivityKeys: playlistWriteKeys,
      });
      if (Exit.isFailure(exit)) {
        onFeedback(getExitErrorMessage(exit, "Failed to add to playlist"));
        setPendingPlaylistKey(null);
        return;
      }
      onFeedback(`Added to ${playlistTitle}`);
      onOpenChange(false);
      setPendingPlaylistKey(null);
    })();
  };

  const createPlaylist = () => {
    const title = newTitle.trim();
    if (!title || isBusy) {
      return;
    }

    setIsCreating(true);
    void (async () => {
      const exit = await createPlaylistMutation({
        payload: {
          serverId,
          serverUrl,
          authToken,
          title,
          type: playlistType,
          ratingKey: item.ratingKey,
          key: item.key,
        },
        reactivityKeys: playlistWriteKeys,
      });
      if (Exit.isFailure(exit)) {
        onFeedback(getExitErrorMessage(exit, "Failed to create playlist"));
        setIsCreating(false);
        return;
      }
      const result = asCreatePlaylistResult(exit.value);
      onFeedback(`Created playlist "${result.title}"`);
      setNewTitle("");
      onOpenChange(false);
      setIsCreating(false);
    })();
  };

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
              {isCreating ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Plus data-icon="inline-start" />
              )}
              Create
            </Button>
          </form>

          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {isPlaylistsPending ? (
              <PlaylistStatus>
                <Loader2 className="size-4 animate-spin" /> Loading playlists…
              </PlaylistStatus>
            ) : isPlaylistsError ? (
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

function getExitErrorMessage(
  exit: Exit.Exit<unknown, unknown>,
  fallback: string,
): string {
  const error = Exit.findErrorOption(exit);
  if (
    Option.isSome(error) &&
    error.value !== null &&
    typeof error.value === "object" &&
    "message" in error.value &&
    typeof (error.value as { message: unknown }).message === "string"
  ) {
    return (error.value as { message: string }).message;
  }
  return fallback;
}
