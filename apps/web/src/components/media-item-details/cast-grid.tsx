import { getPlexImageUrl, type ItemMetadata } from "@multiplex/plex-query";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";

import { DetailsSection } from "./details-section";

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
    <DetailsSection title="Cast & Crew" bleed>
      <div className="relative">
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
          className="from-background via-background/80 pointer-events-none absolute inset-y-0 right-0 w-12 bg-linear-to-l to-transparent sm:hidden"
        />
      </div>
    </DetailsSection>
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
    <div className="flex w-28 shrink-0 flex-col items-center gap-2.5 text-center sm:w-32">
      <Avatar className="ring-border size-[72px] ring-1 sm:size-20">
        {imageUrl && <AvatarImage src={imageUrl} alt={name} />}
        <AvatarFallback>{getPersonInitials(name)}</AvatarFallback>
      </Avatar>
      <div className="flex min-h-16 w-full flex-col gap-1">
        <p className="text-foreground line-clamp-2 text-sm leading-5 font-medium">
          {name}
        </p>
        {role && (
          <p className="text-muted-foreground line-clamp-2 text-xs leading-5">
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
