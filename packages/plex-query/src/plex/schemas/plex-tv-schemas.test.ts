import { describe, expect, test } from "bun:test";

import { rawUserInfoSchema } from "./plex-tv-schemas";

const baseUserInfo = {
  id: 1,
  uuid: "user-uuid",
  username: "viewer",
  title: "Viewer",
  email: "viewer@example.test",
  friendlyName: "Viewer",
  locale: "en",
  confirmed: true,
  joinedAt: 1_700_000_000,
  emailOnlyAuth: false,
  hasPassword: true,
  protected: false,
  thumb: "https://example.test/avatar.png",
  authToken: "account-token",
  subscription: {
    active: false,
    subscribedAt: null,
    status: "Inactive",
    paymentService: null,
    plan: null,
    features: [],
  },
  restricted: false,
  anonymous: false,
  home: true,
  guest: false,
  homeSize: 1,
  homeAdmin: true,
  maxHomeSize: 15,
  rememberExpiresAt: 1_800_000_000,
  profile: {
    autoSelectAudio: true,
    defaultAudioAccessibility: 0,
    defaultAudioLanguage: null,
    defaultAudioLanguages: null,
    defaultSubtitleLanguage: null,
    defaultSubtitleLanguages: null,
    autoSelectSubtitle: 0,
    defaultSubtitleAccessibility: 0,
    defaultSubtitleForced: 0,
    watchedIndicator: 1,
    mediaReviewsVisibility: 0,
    mediaReviewsLanguages: null,
  },
  adsConsentReminderAt: null,
  attributionPartner: null,
};

describe("rawUserInfoSchema advertising consent", () => {
  test.each([
    ["unset", null, null],
    ["accepted", true, 1_777_068_552],
    ["declined", false, 1_777_068_552],
  ])("accepts %s consent", (_label, adsConsent, adsConsentSetAt) => {
    const parsed = rawUserInfoSchema.safeParse({
      ...baseUserInfo,
      adsConsent,
      adsConsentSetAt,
    });

    expect(parsed.success).toBe(true);
  });
});
