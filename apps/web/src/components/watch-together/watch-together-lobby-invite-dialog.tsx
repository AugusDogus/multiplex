"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "~/components/ui/dialog";
import { WatchTogetherInviteePicker } from "~/components/watch-together/watch-together-invitee-picker";
import { api } from "~/trpc/api";

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
  const utils = api.useUtils();
  const inviteUsers = api.plex.inviteWatchTogetherUsers.useMutation({
    onSuccess: async (_data, variables) => {
      await utils.plex.getWatchTogetherRoom.invalidate({ roomId });
      toastManager.add({
        title:
          variables.users.length === 1
            ? "Invited 1 friend"
            : `Invited ${variables.users.length} friends`,
        type: "success",
      });
      handleOpenChange(false);
    },
    onError: () => {
      toastManager.add({
        title: "Couldn't send the invite",
        type: "error",
      });
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedUsers([]);
    }
    onOpenChange(nextOpen);
  };

  const sendInvite = () => {
    if (selectedUsers.length === 0 || inviteUsers.isPending) {
      return;
    }
    inviteUsers.mutate({ roomId, users: selectedUsers });
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

        <DialogPanel>
          <WatchTogetherInviteePicker
            enabled={open}
            selectedUserIds={selectedUsers}
            onSelectedUserIdsChange={setSelectedUsers}
            excludeUserIds={existingUserIds}
            disabled={inviteUsers.isPending}
            emptyHint="Everyone you can invite is already in this session."
          />
        </DialogPanel>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={inviteUsers.isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={selectedUsers.length === 0 || inviteUsers.isPending}
            onClick={sendInvite}
            className="min-w-32"
          >
            {inviteUsers.isPending && (
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
