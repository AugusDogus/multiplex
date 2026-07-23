"use client";

import { Play, Users } from "lucide-react";

import { GuestPageFrame } from "~/components/watch-together/guest-page-frame";

interface GuestLobbyParticipant {
  readonly id: string;
  readonly name: string;
  readonly local: boolean;
}

interface GuestLobbyProps {
  hostTitle: string;
  itemTitle: string;
  hostWatching: boolean;
  nickname: string;
  guestDevices: readonly GuestLobbyParticipant[];
}

function GuestDeviceRow({ name, local }: { name: string; local: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      <div className="bg-primary size-2.5 rounded-full" />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">
        {name || "Guest"}
        {local ? (
          <span className="text-muted-foreground font-normal"> (You)</span>
        ) : null}
      </p>
      <span className="text-muted-foreground text-xs">In lobby</span>
    </div>
  );
}

export function GuestLobby({
  hostTitle,
  itemTitle,
  hostWatching,
  nickname,
  guestDevices,
}: GuestLobbyProps) {
  return (
    <GuestPageFrame>
      <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
        {hostWatching ? (
          <Play className="size-6" />
        ) : (
          <Users className="size-6" />
        )}
      </div>
      <div className="space-y-2 text-center">
        <p className="text-muted-foreground text-sm">
          {hostTitle} invited you to
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{itemTitle}</h1>
        <p className="text-muted-foreground text-sm">
          {hostWatching
            ? "The host started playback. Connecting your player…"
            : "You're in. Playback will begin when the host presses Start."}
        </p>
      </div>
      <div className="bg-card w-full max-w-md rounded-2xl border p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Guest devices</h2>
          <span className="text-muted-foreground text-xs">
            {Math.max(1, guestDevices.length)} connected
          </span>
        </div>
        <div className="space-y-2">
          {guestDevices.length === 0 ? (
            <GuestDeviceRow name={nickname.trim()} local />
          ) : (
            guestDevices.map((device) => (
              <GuestDeviceRow
                key={device.id}
                name={device.name}
                local={device.local}
              />
            ))
          )}
        </div>
      </div>
    </GuestPageFrame>
  );
}
