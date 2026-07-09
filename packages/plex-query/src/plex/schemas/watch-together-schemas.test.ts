import { describe, expect, test } from "bun:test";
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
