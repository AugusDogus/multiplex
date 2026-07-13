import { describe, expect, test } from "bun:test";

import { parsePlexHomeUsersXml } from "./plex-home-schemas";

describe("parsePlexHomeUsersXml", () => {
  test("normalizes admin and built-in Guest attributes", () => {
    const users = parsePlexHomeUsersXml(`
      <MediaContainer size="2">
        <User id="10" uuid="owner-uuid" title="Owner &amp; Admin" admin="1" guest="0" protected="1" restricted="0" />
        <User id="20" uuid="guest-uuid" title="Guest" admin="0" guest="1" protected="0" restricted="1" />
      </MediaContainer>
    `);

    expect(users).toEqual([
      {
        id: 10,
        uuid: "owner-uuid",
        title: "Owner & Admin",
        admin: true,
        guest: false,
        protected: true,
        restricted: false,
      },
      {
        id: 20,
        uuid: "guest-uuid",
        title: "Guest",
        admin: false,
        guest: true,
        protected: false,
        restricted: true,
      },
    ]);
  });

  test("rejects an empty or malformed response", () => {
    expect(() => parsePlexHomeUsersXml("<MediaContainer />")).toThrow();
  });
});
