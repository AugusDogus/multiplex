import { z } from "zod";

/* ────────────────────────────────────────────────────────────
   Plex.tv API Schemas
   Schemas for PlexTvClient - user info, devices, sessions
   ──────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────
   Device & Session Schemas
   ──────────────────────────────────────────────────────────── */

export const deviceSchema = z.object({
  name: z.string(),
  product: z.string(),
  productVersion: z.string(),
  platform: z.string(),
  platformVersion: z.string(),
  device: z.string(),
  clientIdentifier: z.string(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  provides: z.string(),
  ownerId: z.number().nullable(),
  sourceTitle: z.string().nullable(),
  publicAddress: z.string(),
  accessToken: z.string().nullable(),
  owned: z.boolean(),
  home: z.boolean(),
  synced: z.boolean(),
  relay: z.boolean(),
  presence: z.boolean(),
  httpsRequired: z.boolean(),
  publicAddressMatches: z.boolean(),
  dnsRebindingProtection: z.boolean().nullish(),
  natLoopbackSupported: z.boolean().nullish(),
  connections: z.array(
    z.object({
      protocol: z.string(),
      address: z.string(),
      port: z.number(),
      uri: z.string(),
      local: z.boolean(),
      relay: z.boolean(),
      IPv6: z.boolean(),
    }),
  ),
});

export const authCallbackSchema = z.object({
  id: z.preprocess((value) => parseInt(z.string().parse(value)), z.number()),
  code: z.string(),
});

export const sessionsSchema = z.array(deviceSchema);

/* ────────────────────────────────────────────────────────────
   User Settings Schemas
   ──────────────────────────────────────────────────────────── */

export const recentSearchSchema = z.object({
  query: z.string(),
  pivot: z.string(),
  searchType: z.number().optional(),
});

export const pinnedSourceSchema = z.object({
  key: z.string(),
  sourceType: z.string(),
  machineIdentifier: z.string(),
  providerIdentifier: z.string(),
  directoryID: z.string(),
  title: z.string(),
  serverFriendlyName: z.string(),
  serverSourceTitle: z.string().nullable(),
  isFullOwnedServer: z.boolean(),
  hiddenAt: z
    .string()
    .nullable()
    .or(z.undefined())
    .transform((val) => val ?? null),
});

export const reminderSchema = z.object({
  id: z.string(),
  remindAfter: z.string(),
  times: z.number(),
});

// Hub configuration for home screen
export const hubConfigSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  title: z.string().optional(),
  hubKey: z.string().optional(),
  context: z.string().optional(),
  visible: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export const homeSettingsSchema = z.object({
  settingsKey: z.string(),
  preferredServerID: z.string(),
  hubs: z.array(hubConfigSchema),
});

export const sidebarSettingsSchema = z.object({
  hasCompletedSetup: z.boolean(),
  pinnedSources: z.array(pinnedSourceSchema),
});

// Main experience settings schema - this will be flattened into the main settings object
export const experienceSettingsSchema = z.object({
  autoHomeHubsEnabled: z.boolean().optional(),
  shouldSaveLastSourcePivots: z.boolean().optional(),
  autoPinnedProviders: z.array(z.string()).optional(),
  dismissedWhatsNewFeatures: z.record(z.string(), z.boolean()).optional(),
  dismissProfileGetStartedCard: z.boolean().optional(),
  remoteQuality: z.number().optional(),
  audioBoost: z.number().optional(),
  forceTranscodeProtocolHLS: z.boolean().optional(),
  columnWidthMultiplier: z.number().optional(),
  dashboardNowPlayingShowDetails: z.boolean().optional(),
  directoryListStyles: z.record(z.string(), z.string()).optional(),
  savedDirectoryListKeys: z.record(z.string(), z.string()).optional(),
  showAdvancedSettings: z.boolean().optional(),
  showPrePlayArtwork: z.boolean().optional(),
  recentSearches: z.array(recentSearchSchema).optional(),
  schemaVersion: z.number().optional(),
  homeSettings: homeSettingsSchema.optional(),
  sidebarSettings: sidebarSettingsSchema.optional(),
  reminders: z.array(reminderSchema).optional(),
});

// Schema for other (non-experience) settings stored individually
export const otherSettingSchema = z.object({
  type: z.string(),
  value: z.string(),
  hidden: z.boolean(),
  updatedAt: z.number(),
});

// Base setting schema from API
export const plexSettingSchema = z.object({
  id: z.string(),
  type: z.string(),
  value: z.string(),
  hidden: z.boolean(),
  updatedAt: z.number(),
});

// Combined settings schema with proper typing (no Record<string, unknown> intersection)
export const plexSettingsSchema = z.array(plexSettingSchema).transform((settingsArray) => {
  // Start with default experience settings
  let experienceSettings: ExperienceSettings = {};
  const otherSettings: Record<string, OtherSetting> = {};

  for (const setting of settingsArray) {
    if (setting.id === "experience" && setting.type === "json") {
      try {
        const parsedValue = JSON.parse(setting.value);
        experienceSettings = experienceSettingsSchema.parse(parsedValue);
      } catch (error) {
        console.warn("Failed to parse experience settings:", error);
      }
    } else {
      otherSettings[setting.id] = {
        type: setting.type,
        value: setting.value,
        hidden: setting.hidden,
        updatedAt: setting.updatedAt,
      };
    }
  }

  return {
    ...experienceSettings,
    otherSettings,
  };
});

// Type for other settings
export type OtherSetting = z.infer<typeof otherSettingSchema>;

/* ────────────────────────────────────────────────────────────
   User Info Schemas
   ──────────────────────────────────────────────────────────── */

// Raw user info schema that matches the API response exactly
export const rawUserInfoSchema = z.object({
  id: z.number(),
  uuid: z.string(),
  username: z.string(),
  title: z.string(),
  email: z.string(),
  friendlyName: z.string(),
  locale: z.string().nullable(),
  confirmed: z.boolean(),
  joinedAt: z.number(),
  emailOnlyAuth: z.boolean(),
  hasPassword: z.boolean(),
  protected: z.boolean(),
  thumb: z.string(),
  authToken: z.string(),
  mailingListStatus: z.string().optional(),
  mailingListActive: z.boolean().optional(),
  scrobbleTypes: z.string().optional(),
  country: z.string().optional(),
  providers: z
    .array(z.object({ id: z.string(), uid: z.string() }))
    .optional()
    .default([]),
  subscription: z.object({
    active: z.boolean(),
    subscribedAt: z.string().nullable(),
    status: z.string(),
    paymentService: z.string().nullable(),
    plan: z.string().nullable(),
    features: z.array(z.string()),
  }),
  subscriptionDescription: z.string().nullable(),
  restricted: z.boolean(),
  anonymous: z.boolean(),
  home: z.boolean(),
  guest: z.boolean(),
  homeSize: z.number(),
  homeAdmin: z.boolean(),
  maxHomeSize: z.number(),
  rememberExpiresAt: z.number(),
  profile: z.object({
    autoSelectAudio: z.boolean(),
    defaultAudioAccessibility: z.number(),
    defaultAudioLanguage: z.string().nullable(),
    defaultAudioLanguages: z.null(),
    defaultSubtitleLanguage: z.string().nullable(),
    defaultSubtitleLanguages: z.null(),
    autoSelectSubtitle: z.number(),
    defaultSubtitleAccessibility: z.number(),
    defaultSubtitleForced: z.number(),
    watchedIndicator: z.number(),
    mediaReviewsVisibility: z.number(),
    mediaReviewsLanguages: z.null(),
  }),
  entitlements: z.array(z.string()).optional().default([]),
  roles: z.array(z.string()).optional().default([]),
  settings: z.array(plexSettingSchema).optional(),
  subscriptions: z
    .array(
      z.object({
        id: z.number(),
        mode: z.string(),
        renewsAt: z.null(),
        endsAt: z.null(),
        billing: z.object({
          paymentMethodId: z.null(),
          internalPaymentMethod: z.object({}),
        }),
        canceled: z.boolean(),
        gracePeriod: z.boolean(),
        onHold: z.boolean(),
        canReactivate: z.boolean(),
        canUpgrade: z.boolean(),
        canDowngrade: z.boolean(),
        canConvert: z.boolean(),
        type: z.string(),
        state: z.string(),
      }),
    )
    .optional()
    .default([]),
  // Past subscriptions - similar structure to subscriptions but may have additional fields
  pastSubscriptions: z
    .array(
      z.object({
        id: z.number(),
        mode: z.string(),
        renewsAt: z.string().nullable(),
        endsAt: z.string().nullable(),
        billing: z
          .object({
            paymentMethodId: z.string().nullable(),
            internalPaymentMethod: z.object({}).optional(),
          })
          .optional(),
        canceled: z.boolean().optional(),
        gracePeriod: z.boolean().optional(),
        onHold: z.boolean().optional(),
        canReactivate: z.boolean().optional(),
        canUpgrade: z.boolean().optional(),
        canDowngrade: z.boolean().optional(),
        canConvert: z.boolean().optional(),
        type: z.string(),
        state: z.string(),
      }),
    )
    .optional()
    .default([]),
  // Trials - promotional trial periods
  trials: z
    .array(
      z.object({
        id: z.number().optional(),
        type: z.string(),
        status: z.string().optional(),
        startedAt: z.string().optional(),
        endsAt: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  services: z
    .array(
      z.union([
        z.object({
          identifier: z.string(),
          endpoint: z.string(),
          token: z.string(),
          secret: z.null(),
          status: z.string(),
        }),
        z.object({
          identifier: z.string(),
          endpoint: z.string(),
          token: z.null(),
          secret: z.null(),
          status: z.string(),
        }),
        z.object({
          identifier: z.string(),
          endpoint: z.string(),
          token: z.string(),
          secret: z.string(),
          status: z.string(),
        }),
      ]),
    )
    .optional()
    .default([]),
  adsConsent: z.null(),
  adsConsentSetAt: z.null(),
  adsConsentReminderAt: z.null(),
  experimentalFeatures: z.boolean().optional(),
  twoFactorEnabled: z.boolean().optional(),
  backupCodesCreated: z.boolean().optional(),
  attributionPartner: z.null(),
});

// Transformed user info schema with parsed settings
export const userInfoSchema = rawUserInfoSchema.transform((data) => {
  // Transform settings array if it exists
  let transformedSettings: PlexSettings | undefined;

  if (data.settings) {
    transformedSettings = plexSettingsSchema.parse(data.settings);
  }

  return {
    ...data,
    settings: transformedSettings,
  };
});

/* ────────────────────────────────────────────────────────────
   Type Exports
   ──────────────────────────────────────────────────────────── */

export type PlexDevice = z.infer<typeof deviceSchema>;
export type PlexAuthCallback = z.infer<typeof authCallbackSchema>;
export type RawPlexUserInfo = z.infer<typeof rawUserInfoSchema>;
export type PlexUserInfo = z.infer<typeof userInfoSchema>;
export type PlexSettings = z.infer<typeof plexSettingsSchema>;
export type ExperienceSettings = z.infer<typeof experienceSettingsSchema>;
export type RecentSearch = z.infer<typeof recentSearchSchema>;
export type PinnedSource = z.infer<typeof pinnedSourceSchema>;
