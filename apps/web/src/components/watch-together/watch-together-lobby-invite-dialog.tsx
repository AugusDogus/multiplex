"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAtomSet } from "@effect/atom-react";
import * as Exit from "effect/Exit";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { WatchTogetherInviteePicker } from "~/components/watch-together/watch-together-invitee-picker";
import { inviteWatchTogetherUsers } from "~/lib/effect/plex-atoms";
import { watchTogetherRoomWriteKeysFor } from "~/lib/effect/reactivity-keys";

interface WatchTogetherLobbyInviteDialogProps {
  roomId: string;
  /** Users already in the room, hidden from the picker. */
  existingUserIds: number[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Invite more friends into an existing Watch Together room from the lobby —
 * the same capability the official Plex lobby's "+ Invite…" offers, which is
 * what gives a lobby (even a solo one) a purpose.
 */
export function WatchTogetherLobbyInviteDialog({
  roomId,
  existingUserIds,
  open,
  onOpenChange,
}: WatchTogetherLobbyInviteDialogProps) {
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [isPending, setIsPending] = useState(false);
  const inviteUsers = useAtomSet(inviteWatchTogetherUsers, {
    mode: "promiseExit",
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedUsers([]);
    }
    onOpenChange(nextOpen);
  };

  const sendInvite = async () => {
    if (selectedUsers.length === 0 || isPending) {
      return;
    }
    setIsPending(true);
    const exit = await inviteUsers({
      params: { roomId },
      payload: { users: selectedUsers },
      reactivityKeys: watchTogetherRoomWriteKeysFor(roomId),
    });
    if (Exit.isFailure(exit)) {
      toast.error("Couldn't send the invite");
      setIsPending(false);
      return;
    }
    toast.success(
      selectedUsers.length === 1
        ? "Invited 1 friend"
        : `Invited ${selectedUsers.length} friends`,
    );
    handleOpenChange(false);
    setIsPending(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite friends</DialogTitle>
          <DialogDescription>
            Add more people to this Watch Together session.
          </DialogDescription>
        </DialogHeader>

        <WatchTogetherInviteePicker
          enabled={open}
          selectedUserIds={selectedUsers}
          onSelectedUserIdsChange={setSelectedUsers}
          excludeUserIds={existingUserIds}
          disabled={isPending}
          emptyHint="Everyone you can invite is already in this session."
        />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={selectedUsers.length === 0 || isPending}
            onClick={() => {
              void sendInvite();
            }}
            className="min-w-32"
          >
            {isPending && (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            )}
            {selectedUsers.length > 0
              ? `Invite ${selectedUsers.length}`
              : "Invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
