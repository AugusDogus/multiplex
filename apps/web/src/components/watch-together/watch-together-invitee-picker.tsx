"use client";

import { Check, Loader2 } from "lucide-react";

import { Button } from "~/components/ui/button";
import {
  PlexUserAvatar,
  PlexUserAvatarStack,
} from "~/components/watch-together/plex-user-avatar";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/api";

interface WatchTogetherInviteePickerProps {
  /** Gate the invitees query to when the picker is actually shown. */
  enabled: boolean;
  selectedUserIds: number[];
  onSelectedUserIdsChange: (ids: number[]) => void;
  /** Users already in the room, hidden from the list. */
  excludeUserIds?: number[];
  /** Disable interaction while a create/invite request is in flight. */
  disabled?: boolean;
  /** Shown when there are no invitees left to pick. */
  emptyHint?: string;
}

/**
 * The shared "pick friends to invite" surface: a stable-height selection
 * summary plus the selectable friends list. Used both when creating a room and
 * when inviting more people into an existing Watch Together lobby.
 */
export function WatchTogetherInviteePicker({
  enabled,
  selectedUserIds,
  onSelectedUserIdsChange,
  excludeUserIds,
  disabled = false,
  emptyHint = "No Plex friends found.",
}: WatchTogetherInviteePickerProps) {
  const inviteesQuery = api.plex.getWatchTogetherInvitees.useQuery(undefined, {
    enabled,
    staleTime: 60_000,
  });

  const excludeSet = new Set(excludeUserIds ?? []);
  const invitees = (inviteesQuery.data ?? []).filter(
    (invitee) => !excludeSet.has(invitee.id),
  );
  const selectedSet = new Set(selectedUserIds);
  const selectedInvitees = invitees.filter((invitee) =>
    selectedSet.has(invitee.id),
  );

  const toggleInvitee = (id: number) => {
    onSelectedUserIdsChange(
      selectedUserIds.includes(id)
        ? selectedUserIds.filter((currentId) => currentId !== id)
        : [...selectedUserIds, id],
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Fixed height so selecting the first friend doesn't shift the dialog. */}
      <div className="bg-muted/40 flex h-12 items-center gap-3 rounded-lg px-3">
        {selectedInvitees.length > 0 ? (
          <>
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
              disabled={disabled}
              onClick={() => onSelectedUserIdsChange([])}
            >
              Clear
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground text-sm">
            Select friends below to invite them.
          </span>
        )}
      </div>

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
          <InviteStatus>{emptyHint}</InviteStatus>
        ) : (
          invitees.map((invitee) => {
            const selected = selectedSet.has(invitee.id);
            const displayName = invitee.title ?? invitee.username;
            const showUsername =
              Boolean(invitee.username) && invitee.username !== displayName;
            return (
              <button
                key={invitee.id}
                type="button"
                aria-pressed={selected}
                className={cn(
                  "hover:bg-accent focus-visible:ring-ring flex items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2",
                  selected && "bg-accent",
                )}
                disabled={disabled}
                onClick={() => toggleInvitee(invitee.id)}
              >
                <PlexUserAvatar user={invitee} className="size-9" />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 font-medium">
                    {displayName}
                  </span>
                  {showUsername && (
                    <span className="text-muted-foreground line-clamp-1 text-xs">
                      {invitee.username}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-muted-foreground/30",
                  )}
                >
                  {selected && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function InviteStatus({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-muted-foreground flex items-center gap-2 px-3 py-6 text-sm">
      {children}
    </div>
  );
}
