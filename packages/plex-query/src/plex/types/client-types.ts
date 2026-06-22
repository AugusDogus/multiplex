import { type z } from "zod";

/* ────────────────────────────────────────────────────────────
   Shared Client Types & Interfaces
   Common types used by both PlexTvClient and PlexServerClient
   ──────────────────────────────────────────────────────────── */

/**
 * Configuration for Plex clients
 */
export interface PlexConfig {
  product: string;
  clientIdentifier: string;
  version: string;
  platform: string;
}

/**
 * Options for GET requests to Plex APIs
 */
export interface GetRequestOptions<T> {
  endpoint: string;
  params?: Record<string, string | number | boolean>;
  schema?: z.ZodType<T>;
  baseUrl?: string;
  expectEmptyResponse?: boolean;
  xPlexOverrides?: Partial<{
    product: string;
    version: string;
    clientIdentifier: string;
    platform: string;
    platformVersion: string;
    features: string;
    model: string;
    device: string;
    deviceName: string;
    language: string;
    sessionId: string;
    playbackSessionId: string;
    deviceScreenResolution: string;
  }>;
}

/**
 * Options for POST requests to Plex APIs
 */
export interface PostRequestOptions<T> {
  endpoint: string;
  params?: Record<string, string | number | boolean>;
  schema?: z.ZodType<T>;
  baseUrl?: string;
  body?: BodyInit;
  contentType?: string;
  expectEmptyResponse?: boolean;
  xPlexOverrides?: Partial<{
    product: string;
    version: string;
    clientIdentifier: string;
    platform: string;
    platformVersion: string;
    features: string;
    model: string;
    device: string;
    deviceName: string;
    language: string;
    sessionId: string;
    playbackSessionId: string;
    deviceScreenResolution: string;
  }>;
}

export interface PutRequestOptions<T> extends PostRequestOptions<T> {}

/**
 * Custom error class for Plex API errors
 */
export class PlexAPIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public response?: Response,
  ) {
    super(message);
    this.name = "PlexAPIError";
  }
}
