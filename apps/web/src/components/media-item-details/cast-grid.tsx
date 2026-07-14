import type { ItemMetadata } from "@multiplex/plex-query";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { getPlexImagePath } from "~/lib/plex-image";

interface CastGridProps {
  item: Pick<ItemMetadata, "Role">;
  serverId: string;
}

export function CastGrid({ item, serverId }: CastGridProps) {
  const roles = item.Role;
  if (!roles?.length) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-semibold tracking-tight">Cast & Crew</h2>
      <div className="scrollbar-hide -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {roles.slice(0, 18).map((role) => (
          <CastMember
            key={`${role.tag}-${role.role ?? "role"}`}
            name={role.tag}
            role={role.role}
            thumb={role.thumb}
            serverId={serverId}
          />
        ))}
      </div>
    </section>
  );
}

interface CastMemberProps {
  name: string;
  role?: string;
  thumb?: string;
  serverId: string;
}

function CastMember({ name, role, thumb, serverId }: CastMemberProps) {
  const imageUrl = getPlexImagePath(serverId, thumb, {
    width: 160,
    height: 160,
  });

  return (
    <div className="flex w-32 shrink-0 flex-col items-center gap-3 text-center">
      <Avatar className="size-20">
        {imageUrl && <AvatarImage src={imageUrl} alt={name} />}
        <AvatarFallback>{getPersonInitials(name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-h-20 w-full flex-col gap-2">
        <p className="line-clamp-2 text-sm leading-5 font-medium">{name}</p>
        {role && (
          <p className="text-muted-foreground line-clamp-3 text-xs leading-5">
            {role}
          </p>
        )}
      </div>
    </div>
  );
}

function getPersonInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
