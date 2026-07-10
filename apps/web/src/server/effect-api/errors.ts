import { Schema } from "effect";

/** No authenticated Multiplex/Plex session for this request. */
export class UnauthorizedError extends Schema.TaggedErrorClass<UnauthorizedError>()(
  "UnauthorizedError",
  {
    message: Schema.optionalKey(Schema.String),
  },
  { httpApiStatus: 401 },
) {}

/**
 * Upstream Plex (or related) call failed.
 * Defaults to 502 so clients can distinguish gateway failures; handlers may
 * fail with a 500-flavored message by using `InternalPlexError` instead when
 * the cause is local (e.g. unexpected throw before the network call).
 */
export class PlexRequestError extends Schema.TaggedErrorClass<PlexRequestError>()(
  "PlexRequestError",
  {
    operation: Schema.String,
    message: Schema.optionalKey(Schema.String),
  },
  { httpApiStatus: 502 },
) {}

/** Local/internal failure while preparing or adapting a Plex response. */
export class InternalPlexError extends Schema.TaggedErrorClass<InternalPlexError>()(
  "InternalPlexError",
  {
    operation: Schema.String,
    message: Schema.optionalKey(Schema.String),
  },
  { httpApiStatus: 500 },
) {}

/** Requested Plex server (or resource) was not found. */
export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
  "NotFoundError",
  {
    message: Schema.String,
  },
  { httpApiStatus: 404 },
) {}
