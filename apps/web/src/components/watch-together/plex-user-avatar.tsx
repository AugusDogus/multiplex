"use client";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { cn } from "~/lib/utils";

export interface PlexUserLike {
  title?: string | null;
  username?: string | null;
  thumb?: string | null;
}

export function getPlexUserName(user: PlexUserLike): string {
  return user.title ?? user.username ?? "Plex user";
}

function getInitials(name: string): string {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return initials || "?";
}

interface PlexUserAvatarProps {
  user: PlexUserLike;
  className?: string;
  fallbackClassName?: string;
}

export function PlexUserAvatar({
  user,
  className,
  fallbackClassName,
}: PlexUserAvatarProps) {
  const name = getPlexUserName(user);
  const thumb = user.thumb ?? undefined;

  return (
    <Avatar className={className}>
      {thumb && <AvatarImage src={thumb} alt={name} />}
      <AvatarFallback className={cn("text-xs font-medium", fallbackClassName)}>
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

interface PlexUserAvatarStackProps {
  users: PlexUserLike[];
  max?: number;
  className?: string;
  avatarClassName?: string;
}

export function PlexUserAvatarStack({
  users,
  max = 4,
  className,
  avatarClassName,
}: PlexUserAvatarStackProps) {
  if (users.length === 0) {
    return null;
  }

  const visible = users.slice(0, max);
  const overflow = users.length - visible.length;

  return (
    <div className={cn("flex items-center -space-x-2", className)}>
      {visible.map((user, index) => (
        <PlexUserAvatar
          key={`${getPlexUserName(user)}-${index}`}
          user={user}
          className={cn(
            "ring-background size-7 shadow-sm ring-2",
            avatarClassName,
          )}
        />
      ))}
      {overflow > 0 && (
        <span className="bg-muted text-muted-foreground ring-background flex size-7 items-center justify-center rounded-full text-xs font-medium shadow-sm ring-2">
          +{overflow}
        </span>
      )}
    </div>
  );
}
