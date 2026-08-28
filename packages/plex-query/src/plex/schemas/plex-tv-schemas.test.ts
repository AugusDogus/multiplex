import { describe, expect, test } from "bun:test";

import { rawUserInfoSchema } from "./plex-tv-schemas";

const adsConsentReminderSchema = rawUserInfoSchema.pick({
  adsConsentReminderAt: true,
});

describe("rawUserInfoSchema", () => {
  test.each([null, 1_777_068_552])(
    "accepts adsConsentReminderAt value %p",
    (adsConsentReminderAt) => {
      expect(adsConsentReminderSchema.safeParse({ adsConsentReminderAt }).success).toBe(true);
    },
  );
});
