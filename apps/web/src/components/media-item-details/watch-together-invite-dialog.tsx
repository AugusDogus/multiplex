"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  PlexUserAvatar,
  PlexUserAvatarStack,
} from "~/components/watch-together/plex-user-avatar";
import { getWatchTogetherRoomHref } from "~/lib/watch-together-source";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

import type { ItemDetails, PlayTarget } from "./types";

interface WatchTogetherInviteDialogProps {
  item: ItemDetails["item"];
  playTarget: PlayTarget;
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFeedback: (message: string) => void;
}

export function WatchTogetherInviteDialog({
  item,
  playTarget,
  serverId,
  open,
  onOpenChange,
  onFeedback,
}: WatchTogetherInviteDialogProps) {
  const router = useRouter();
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const inviteesQuery = api.plex.getWatchTogetherInvitees.useQuery(undefined, {
    enabled: open,
    staleTime: 60_000,
  });
  const createRoomMutation = api.plex.createWatchTogetherRoom.useMutation({
    onError: (error) => onFeedback(error.message),
    onSuccess: (room) => {
      handleOpenChange(false);
      onFeedback("Watch Together room created");
      router.push(getWatchTogetherRoomHref(room.id));
    },
  });

  const invitees = useMemo(
    () => inviteesQuery.data ?? [],
    [inviteesQuery.data],
  );
  const isBusy = createRoomMutation.isPending || inviteesQuery.isPending;
  const playable = playTarget ?? item;
  const canInvite = Boolean(playTarget && !isBusy);

  const selectedSet = useMemo(() => new Set(selectedUsers), [selectedUsers]);
  const selectedInvitees = useMemo(
    () => invitees.filter((invitee) => selectedSet.has(invitee.id)),
    [invitees, selectedSet],
  );

  const toggleInvitee = (id: number) => {
    setSelectedUsers((current) =>
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id],
    );
  };

  const clearSelection = () => setSelectedUsers([]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedUsers([]);
    }
    onOpenChange(nextOpen);
  };

  const createRoom = () => {
    if (!playTarget || createRoomMutation.isPending) {
      return;
    }

    createRoomMutation.mutate({
      serverId,
      ratingKey: playable.ratingKey,
      key: playable.key,
      title: playable.title,
      users: selectedUsers,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Watch Together</DialogTitle>
          <DialogDescription className="line-clamp-2">
            Invite friends, then start a synchronized session for {item.title}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {selectedInvitees.length > 0 && (
            <div className="bg-muted/40 flex items-center gap-3 rounded-lg px-3 py-2">
              <PlexUserAvatarStack users={selectedInvitees} max={5} />
              <span className="text-sm font-medium">
                {selectedInvitees.length}{" "}
                {selectedInvitees.length === 1 ? "friend" : "friends"} selected
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground ml-auto h-7 px-2"
                disabled={createRoomMutation.isPending}
                onClick={clearSelection}
              >
                Clear
              </Button>
            </div>
          )}

          <p className="text-muted-foreground text-sm">
            Friends and Accounts with Library Access
          </p>
          <div className="-mr-1 flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
            {inviteesQuery.isPending ? (
              <InviteStatus>
                <Loader2 className="size-4 animate-spin" /> Loading friends...
              </InviteStatus>
            ) : inviteesQuery.isError ? (
              <InviteStatus>Could not load invitees.</InviteStatus>
            ) : invitees.length === 0 ? (
              <InviteStatus>
                No Plex friends found. You can still create a room for yourself.
              </InviteStatus>
            ) : (
              invitees.map((invitee) => {
                const selected = selectedSet.has(invitee.id);
                return (
                  <button
                    key={invitee.id}
                    type="button"
                    aria-pressed={selected}
                    className={cn(
                      "hover:bg-accent focus-visible:ring-ring flex items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2",
                      selected && "bg-accent",
                    )}
                    disabled={createRoomMutation.isPending}
                    onClick={() => toggleInvitee(invitee.id)}
                  >
                    <PlexUserAvatar user={invitee} className="size-9" />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 font-medium">
                        {invitee.title ?? invitee.username}
                      </span>
                      <span className="text-muted-foreground line-clamp-1 text-xs">
                        {invitee.username}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/30",
                      )}
                    >
                      {selected && (
                        <Check className="size-3.5" strokeWidth={3} />
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={createRoomMutation.isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={!canInvite} onClick={createRoom}>
            {createRoomMutation.isPending && (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            )}
            {selectedInvitees.length > 0
              ? `Invite ${selectedInvitees.length}`
              : "Create room"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InviteStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 px-3 py-6 text-sm">
      {children}
    </div>
  );
}
