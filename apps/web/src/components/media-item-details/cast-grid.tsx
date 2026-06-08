import { getPlexImageUrl, type ItemMetadata } from "@multiplex/plex-query";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";

interface CastGridProps {
  item: Pick<ItemMetadata, "Role">;
  serverUrl: string | undefined;
  authToken: string | undefined;
}

export function CastGrid({ item, serverUrl, authToken }: CastGridProps) {
  const roles = item.Role;
  if (!roles?.length) {
    return null;
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
        Cast & Crew
      </h2>
      <div className="relative -mx-4 sm:mx-0">
        <div className="scrollbar-hide flex gap-4 overflow-x-auto px-4 pb-2 sm:px-0">
          {roles.slice(0, 18).map((role) => (
            <CastMember
              key={`${role.tag}-${role.role ?? "role"}`}
              name={role.tag}
              role={role.role}
              thumb={role.thumb}
              serverUrl={serverUrl}
              authToken={authToken}
            />
          ))}
        </div>
        <div
          aria-hidden
          className="from-background pointer-events-none absolute inset-y-0 right-0 w-10 bg-linear-to-l to-transparent sm:hidden"
        />
      </div>
    </section>
  );
}

interface CastMemberProps {
  name: string;
  role?: string;
  thumb?: string;
  serverUrl: string | undefined;
  authToken: string | undefined;
}

function CastMember({
  name,
  role,
  thumb,
  serverUrl,
  authToken,
}: CastMemberProps) {
  const imageUrl = getPlexImageUrl(thumb, serverUrl, authToken, {
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
