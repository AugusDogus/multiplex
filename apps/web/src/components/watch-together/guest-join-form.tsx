"use client";

import type { FormEvent } from "react";
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

export function GuestJoinForm({
  nickname,
  joining,
  onNicknameChange,
  onSubmit,
}: GuestJoinFormProps) {
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
              maxLength={40}
              value={nickname}
              onChange={(event) => onNicknameChange(event.target.value)}
              className="pl-9"
              placeholder="Your name"
            />
          </div>
        </label>
        <Button
          className="w-full active:scale-[0.98]"
          disabled={!nickname.trim() || joining}
          aria-busy={joining || undefined}
        >
          {joining ? (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          ) : (
            <Play data-icon="inline-start" />
          )}
          Join session
        </Button>
      </form>
      <p className="text-muted-foreground max-w-sm text-center text-xs leading-5">
        This link grants temporary access to the host&apos;s Plex Guest profile.
        Only open links from someone you trust.
      </p>
    </GuestPageFrame>
  );
}
