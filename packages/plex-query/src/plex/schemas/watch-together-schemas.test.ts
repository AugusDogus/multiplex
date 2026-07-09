import { describe, expect, test } from "vitest";
import { plexFriendSchema } from "./watch-together-schemas";

describe("watch together schemas", () => {
  test("accepts Plex friends with null usernames", () => {
    const friend = plexFriendSchema.parse({
      id: 1,
      uuid: "friend-uuid",
      title: "Friend Name",
      username: null,
      friendlyName: null,
      thumb: null,
    });

    expect(friend.username).toBeNull();
  });
});
