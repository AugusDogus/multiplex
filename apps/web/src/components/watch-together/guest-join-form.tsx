"use client";

import { useSyncExternalStore, type FormEvent } from "react";
import { Loader2, Play, UserRound, Users } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { GuestPageFrame } from "~/components/watch-together/guest-page-frame";

interface GuestJoinFormProps {
  nickname: string;
  joining: boolean;
  onNicknameChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const subscribeToHydration = () => () => undefined;
const getHydratedSnapshot = () => true;
const getServerHydratedSnapshot = () => false;

export function GuestJoinForm({
  nickname,
  joining,
  onNicknameChange,
  onSubmit,
}: GuestJoinFormProps) {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );

  return (
    <GuestPageFrame>
      <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
        <Users className="size-6" />
      </div>
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Join Watch Together
        </h1>
        <p className="text-muted-foreground max-w-md text-sm leading-6">
          Enter a name so the host and other guests can recognize this device.
          You don&apos;t need a Plex account.
        </p>
      </div>
      <form className="w-full max-w-sm space-y-3" onSubmit={onSubmit}>
        <label className="block space-y-2 text-sm font-medium">
          Display name
          <div className="relative">
            <UserRound className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              autoFocus
              autoComplete="nickname"
              disabled={!hydrated}
              maxLength={40}
              value={nickname}
              onChange={(event) => onNicknameChange(event.target.value)}
              className="pl-9"
              placeholder="Your name"
            />
          </div>
        </label>
        <Button
          type="submit"
          className="w-full active:scale-[0.98]"
          disabled={!hydrated || !nickname.trim() || joining}
          aria-busy={joining || undefined}
        >
          {joining ? (
            <Loader2
              className="animate-spin motion-reduce:animate-none"
              data-icon="inline-start"
              data-loading-indicator
            />
          ) : (
            <Play data-icon="inline-start" />
          )}
          {joining ? "Joining..." : "Join session"}
        </Button>
      </form>
      <p className="text-muted-foreground max-w-sm text-center text-xs leading-5">
        This link grants temporary playback access to this Plex server. Only
        open links from someone you trust.
      </p>
    </GuestPageFrame>
  );
}
