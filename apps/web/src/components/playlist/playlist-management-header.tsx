"use client";

import { Loader2, Lock, Pencil, Trash2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { RouterOutputs } from "~/trpc/api";

type Playlist = NonNullable<RouterOutputs["plex"]["getPlaylist"]>;

interface PlaylistManagementHeaderProps {
  playlist: Playlist;
  totalSize: number;
  editable: boolean;
  busy: boolean;
  renameTitle: string;
  renamePending: boolean;
  onRenameTitleChange: (value: string) => void;
  onSubmitRename: () => void;
  onDeleteClick: () => void;
}

export function PlaylistManagementHeader({
  playlist,
  totalSize,
  editable,
  busy,
  renameTitle,
  renamePending,
  onRenameTitleChange,
  onSubmitRename,
  onDeleteClick,
}: PlaylistManagementHeaderProps) {
  const normalizedRenameTitle = renameTitle.trim();

  return (
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
          onClick={onDeleteClick}
          disabled={!editable || busy}
        >
          <Trash2 /> Delete playlist
        </Button>
      </div>

      <form
        className="flex max-w-xl flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmitRename();
        }}
      >
        <Input
          value={renameTitle}
          onChange={(event) => onRenameTitleChange(event.target.value)}
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
          {renamePending ? <Loader2 className="animate-spin" /> : <Pencil />}
          Rename
        </Button>
      </form>
    </section>
  );
}
