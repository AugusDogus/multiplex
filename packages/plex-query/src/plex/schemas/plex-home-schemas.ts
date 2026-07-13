import { z } from "zod";

const xmlBooleanSchema = z
  .enum(["0", "1", "false", "true"])
  .transform((value) => value === "1" || value === "true");

const plexHomeUserXmlAttrsSchema = z
  .object({
    id: z.coerce.number().int().nonnegative(),
    uuid: z.string().min(1),
    title: z.string().default("Plex user"),
    username: z.string().nullish(),
    thumb: z.string().nullish(),
    admin: xmlBooleanSchema.default("0"),
    guest: xmlBooleanSchema.default("0"),
    protected: xmlBooleanSchema.default("0"),
    restricted: xmlBooleanSchema.default("0"),
  })
  .passthrough();

export const plexHomeUserSchema = z.object({
  id: z.number().int().nonnegative(),
  uuid: z.string().min(1),
  title: z.string(),
  username: z.string().nullish(),
  thumb: z.string().nullish(),
  admin: z.boolean(),
  guest: z.boolean(),
  protected: z.boolean(),
  restricted: z.boolean(),
});

export const plexHomeUsersSchema = z.array(plexHomeUserSchema).min(1);

export const switchedPlexHomeUserSchema = z
  .object({
    id: z.number().int().nonnegative(),
    uuid: z.string().min(1),
    title: z.string(),
    authToken: z.string().min(1),
    guest: z.boolean(),
    restricted: z.boolean(),
  })
  .passthrough();

export type PlexHomeUser = z.infer<typeof plexHomeUserSchema>;
export type SwitchedPlexHomeUser = z.infer<typeof switchedPlexHomeUserSchema>;

/**
 * Plex's current Home-user list is still XML even though switching is JSON.
 * Normalize it once here so callers never probe loose attributes.
 */
export function parsePlexHomeUsersXml(xml: string): PlexHomeUser[] {
  const users = [...xml.matchAll(/<User\s+([^>]+?)(?:\/>|>)/g)].map((match) => {
    const rawAttributes = Object.fromEntries(
      [...(match[1] ?? "").matchAll(/([A-Za-z0-9_:-]+)="([^"]*)"/g)].map((attribute) => [
        attribute[1] ?? "",
        decodeXmlAttribute(attribute[2] ?? ""),
      ]),
    );
    return plexHomeUserXmlAttrsSchema.parse(rawAttributes);
  });

  return plexHomeUsersSchema.parse(users);
}

function decodeXmlAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
