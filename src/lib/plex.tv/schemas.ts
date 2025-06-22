import { z } from "zod";

// Plex Settings Schemas
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
  hiddenAt: z.string().nullable(),
});

export const reminderSchema = z.object({
  id: z.string(),
  remindAfter: z.string(),
  times: z.number(),
});

export const homeSettingsSchema = z.object({
  settingsKey: z.string(),
  preferredServerID: z.string(),
  hubs: z.array(z.unknown()), // Can be more specific if needed
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
  dismissedWhatsNewFeatures: z.record(z.boolean()).optional(),
  dismissProfileGetStartedCard: z.boolean().optional(),
  remoteQuality: z.number().optional(),
  audioBoost: z.number().optional(),
  forceTranscodeProtocolHLS: z.boolean().optional(),
  columnWidthMultiplier: z.number().optional(),
  dashboardNowPlayingShowDetails: z.boolean().optional(),
  directoryListStyles: z.record(z.string()).optional(),
  savedDirectoryListKeys: z.record(z.string()).optional(),
  showAdvancedSettings: z.boolean().optional(),
  showPrePlayArtwork: z.boolean().optional(),
  recentSearches: z.array(recentSearchSchema).optional(),
  schemaVersion: z.number().optional(),
  homeSettings: homeSettingsSchema.optional(),
  sidebarSettings: sidebarSettingsSchema.optional(),
  reminders: z.array(reminderSchema).optional(),
});

// Base setting schema
export const plexSettingSchema = z.object({
  id: z.string(),
  type: z.string(),
  value: z.string(),
  hidden: z.boolean(),
  updatedAt: z.number(),
});

// Simplified settings schema that just returns the parsed experience settings merged with other settings
export const plexSettingsSchema = z
  .array(plexSettingSchema)
  .transform((settingsArray): ExperienceSettings & Record<string, unknown> => {
    const result: Record<string, unknown> = {};

    for (const setting of settingsArray) {
      if (setting.id === "experience" && setting.type === "json") {
        try {
          const parsedValue = JSON.parse(setting.value);
          const validatedValue = experienceSettingsSchema.parse(parsedValue);
          Object.assign(result, validatedValue);
        } catch (error) {
          console.warn("Failed to parse experience settings:", error);
        }
      } else {
        result[setting.id] = {
          type: setting.type,
          value: setting.value,
          hidden: setting.hidden,
          updatedAt: setting.updatedAt,
        };
      }
    }

    return result as ExperienceSettings & Record<string, unknown>;
  });

// Plex.tv API Schemas
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

// Raw user info schema that matches the API response exactly
export const rawUserInfoSchema = z.object({
  id: z.number(),
  uuid: z.string(),
  username: z.string(),
  title: z.string(),
  email: z.string(),
  friendlyName: z.string(),
  locale: z.string(),
  confirmed: z.boolean(),
  joinedAt: z.number(),
  emailOnlyAuth: z.boolean(),
  hasPassword: z.boolean(),
  protected: z.boolean(),
  thumb: z.string(),
  authToken: z.string(),
  mailingListStatus: z.string(),
  mailingListActive: z.boolean(),
  scrobbleTypes: z.string(),
  country: z.string(),
  providers: z.array(z.object({ id: z.string(), uid: z.string() })),
  subscription: z.object({
    active: z.boolean(),
    subscribedAt: z.string(),
    status: z.string(),
    paymentService: z.string(),
    plan: z.string(),
    features: z.array(z.string()),
  }),
  subscriptionDescription: z.string(),
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
    defaultAudioLanguage: z.string(),
    defaultAudioLanguages: z.null(),
    defaultSubtitleLanguage: z.string(),
    defaultSubtitleLanguages: z.null(),
    autoSelectSubtitle: z.number(),
    defaultSubtitleAccessibility: z.number(),
    defaultSubtitleForced: z.number(),
    watchedIndicator: z.number(),
    mediaReviewsVisibility: z.number(),
    mediaReviewsLanguages: z.null(),
  }),
  entitlements: z.array(z.string()),
  roles: z.array(z.string()),
  settings: z.array(plexSettingSchema).optional(),
  subscriptions: z.array(
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
  ),
  pastSubscriptions: z.array(z.unknown()),
  trials: z.array(z.unknown()),
  services: z.array(
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
  ),
  adsConsent: z.null(),
  adsConsentSetAt: z.null(),
  adsConsentReminderAt: z.null(),
  experimentalFeatures: z.boolean(),
  twoFactorEnabled: z.boolean(),
  backupCodesCreated: z.boolean(),
  attributionPartner: z.null(),
});

// Transformed user info schema with parsed settings
export const userInfoSchema = rawUserInfoSchema.transform((data) => {
  // Transform settings array if it exists
  let transformedSettings:
    | (ExperienceSettings & Record<string, unknown>)
    | undefined;

  if (data.settings) {
    transformedSettings = plexSettingsSchema.parse(data.settings);
  }

  return {
    ...data,
    settings: transformedSettings,
  };
});

// Simplified directory schemas - break these out instead of complex unions
const BaseDirectorySchema = z.object({
  title: z.string(),
});

const LibrarySectionSchema = BaseDirectorySchema.extend({
  id: z.string(),
  key: z.string(),
  hubKey: z.string(),
  type: z.string(), // movie, show, artist, etc.
  agent: z.string(),
  language: z.string(),
  refreshing: z.boolean(),
  scanner: z.string(),
  uuid: z.string(),
  updatedAt: z.number(),
  scannedAt: z.number(),
  Pivot: z
    .array(
      z.object({
        id: z.string(),
        key: z.string(),
        type: z.string(),
        title: z.string(),
        context: z.string(),
        symbol: z.string(),
      }),
    )
    .optional(),
});

const PlaylistDirectorySchema = BaseDirectorySchema.extend({
  id: z.literal("playlists"),
  key: z.string(),
  type: z.literal("playlist"),
  Pivot: z.array(
    z.object({
      id: z.string(),
      key: z.string(),
      type: z.string(),
      title: z.string(),
      context: z.string(),
      symbol: z.string(),
    }),
  ),
});

const LiveTVDirectorySchema = BaseDirectorySchema.extend({
  id: z.string(),
  hubKey: z.string().optional(),
  Pivot: z
    .array(
      z.object({
        id: z.string(),
        key: z.string(),
        type: z.string(),
        title: z.string(),
        context: z.string(),
        symbol: z.string(),
      }),
    )
    .optional(),
});

const HomeDirectorySchema = BaseDirectorySchema.extend({
  hubKey: z.literal("/hubs"),
});

const GenericDirectorySchema = BaseDirectorySchema.extend({
  type: z.string().optional(),
  key: z.string().optional(),
  icon: z.string().optional(),
  updatedAt: z.number().optional(),
});

// Union of all directory types
const DirectorySchema = z.union([
  LibrarySectionSchema,
  PlaylistDirectorySchema,
  LiveTVDirectorySchema,
  HomeDirectorySchema,
  GenericDirectorySchema,
]);

// Simplified Feature schema
const FeatureSchema = z.object({
  key: z.string().optional(),
  type: z.string(),
  Directory: z.array(DirectorySchema).optional(),
  Action: z
    .array(
      z.object({
        id: z.string(),
        key: z.string(),
      }),
    )
    .optional(),
  flavor: z.string().optional(),
  scrobbleKey: z.string().optional(),
  unscrobbleKey: z.string().optional(),
});

// Simplified MediaProvider schema
const MediaProviderSchema = z.object({
  identifier: z.string().optional(),
  title: z.string(),
  types: z.string().optional(),
  protocols: z.string().optional(),
  Feature: z.array(FeatureSchema),
  // LiveTV specific fields
  id: z.number().optional(),
  parentID: z.number().optional(),
  providerIdentifier: z.string().optional(),
  epgSource: z.string().optional(),
  friendlyName: z.string().optional(),
});

// Clean MediaContainer schema
export const MediaContainerSchema = z.object({
  MediaContainer: z
    .object({
      size: z.number(),
      allowCameraUpload: z.boolean().optional(),
      allowChannelAccess: z.boolean().optional(),
      allowMediaDeletion: z.boolean().optional(),
      allowSharing: z.boolean().optional(),
      allowSync: z.boolean().optional(),
      allowTuners: z.boolean().optional(),
      friendlyName: z.string(),
      machineIdentifier: z.string(),
      MediaProvider: z.array(MediaProviderSchema),
      // ... other MediaContainer properties can be added as needed
    })
    .passthrough(), // Allow other properties we don't care about
});

// Type exports
export type PlexDevice = z.infer<typeof deviceSchema>;
export type PlexAuthCallback = z.infer<typeof authCallbackSchema>;
export type RawPlexUserInfo = z.infer<typeof rawUserInfoSchema>;
export type PlexUserInfo = z.infer<typeof userInfoSchema>;
export type PlexSettings = z.infer<typeof plexSettingsSchema>;
export type ExperienceSettings = z.infer<typeof experienceSettingsSchema>;
export type RecentSearch = z.infer<typeof recentSearchSchema>;
export type PinnedSource = z.infer<typeof pinnedSourceSchema>;
export type MediaContainer = z.infer<typeof MediaContainerSchema>;
export type MediaProvider = z.infer<typeof MediaProviderSchema>;
export type Directory = z.infer<typeof DirectorySchema>;
export type LibrarySection = z.infer<typeof LibrarySectionSchema>;
