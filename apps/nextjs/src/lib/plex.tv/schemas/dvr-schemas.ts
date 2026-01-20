import { z } from "zod";

/* ────────────────────────────────────────────────────────────
   DVR Schemas
   Schemas for DVR (Digital Video Recorder) functionality
   ──────────────────────────────────────────────────────────── */

// Channel mapping schema
const channelMappingSchema = z.object({
  channelKey: z.string(),
  deviceIdentifier: z.string(),
  enabled: z.string(),
  lineupIdentifier: z.string(),
});

// Device setting schema
const deviceSettingSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  type: z.string(),
  default: z.string(),
  value: z.string(),
  hidden: z.boolean(),
  advanced: z.boolean(),
  group: z.string(),
  enumValues: z.string().optional(),
});

// Device schema
const deviceSchema = z.object({
  parentID: z.number(),
  key: z.string(),
  uuid: z.string(),
  uri: z.string(),
  protocol: z.string(),
  status: z.string(),
  state: z.string(),
  lastSeenAt: z.number(),
  canTranscode: z.string(),
  deviceId: z.string(),
  make: z.string(),
  model: z.string(),
  modelNumber: z.string(),
  source: z.string(),
  sources: z.string(),
  thumb: z.string(),
  title: z.string(),
  tuners: z.string(),
  ChannelMapping: z.array(channelMappingSchema),
  Setting: z.array(deviceSettingSchema),
});

// Lineup schema
const lineupSchema = z.object({
  id: z.string(),
  title: z.string(),
});

// DVR setting schema
const dvrSettingSchema = z.object({
  id: z.string(),
  label: z.string(),
  summary: z.string(),
  type: z.string(),
  default: z.string(),
  value: z.string(),
  hidden: z.boolean(),
  advanced: z.boolean(),
  group: z.string(),
  enumValues: z.string().optional(),
});

// DVR schema
const dvrSchema = z.object({
  key: z.string(),
  uuid: z.string(),
  language: z.string(),
  lineupTitle: z.string(),
  lineup: z.string(),
  country: z.string(),
  refreshedAt: z.number(),
  epgIdentifier: z.string(),
  Device: z.array(deviceSchema),
  Lineup: z.array(lineupSchema),
  Setting: z.array(dvrSettingSchema),
});

// DVRs response schema
export const dvrsResponseSchema = z.object({
  MediaContainer: z.object({
    size: z.number(),
    Dvr: z.array(dvrSchema),
  }),
});

/* ────────────────────────────────────────────────────────────
   Type Exports
   ──────────────────────────────────────────────────────────── */

export type DVRsResponse = z.infer<typeof dvrsResponseSchema>;
export type DVR = z.infer<typeof dvrSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type ChannelMapping = z.infer<typeof channelMappingSchema>;
export type Lineup = z.infer<typeof lineupSchema>;
export type DVRSetting = z.infer<typeof dvrSettingSchema>;
export type DeviceSetting = z.infer<typeof deviceSettingSchema>;
