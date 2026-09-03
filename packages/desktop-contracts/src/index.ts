import * as Schema from "effect/Schema";

const NonNegative = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
const Positive = Schema.Number.check(Schema.isGreaterThan(0));
const UnitInterval = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }));

export const NativePlayerPlaybackIdentity = Schema.Struct({
  streamSessionId: Schema.String,
  serverId: Schema.String,
  ratingKey: Schema.String,
  sourceGeneration: Schema.Int,
});
export type NativePlayerPlaybackIdentity = typeof NativePlayerPlaybackIdentity.Type;
export type NativePlayerPlaybackIdentityEncoded = typeof NativePlayerPlaybackIdentity.Encoded;

export const NativePlayerLoadInput = Schema.Struct({
  identity: NativePlayerPlaybackIdentity,
  url: Schema.String,
  title: Schema.String,
  startSeconds: NonNegative,
  volume: UnitInterval,
  muted: Schema.Boolean,
  playbackRate: Positive,
});
export type NativePlayerLoadInput = typeof NativePlayerLoadInput.Type;
export type NativePlayerLoadInputEncoded = typeof NativePlayerLoadInput.Encoded;

export const NativePlayerSeekInput = Schema.Struct({
  identity: NativePlayerPlaybackIdentity,
  seconds: NonNegative,
});
export type NativePlayerSeekInputEncoded = typeof NativePlayerSeekInput.Encoded;

export const NativeVideoSurface = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Hidden") }),
  Schema.Struct({
    _tag: Schema.Literal("Visible"),
    x: Schema.Number,
    y: Schema.Number,
    width: NonNegative,
    height: NonNegative,
    deviceScaleFactor: Positive,
  }),
]);
export type NativeVideoSurface = typeof NativeVideoSurface.Type;
export type NativeVideoSurfaceEncoded = typeof NativeVideoSurface.Encoded;

export const NativePlayerVolumeInput = Schema.Struct({
  identity: NativePlayerPlaybackIdentity,
  volume: UnitInterval,
  muted: Schema.Boolean,
});
export type NativePlayerVolumeInputEncoded = typeof NativePlayerVolumeInput.Encoded;

export const NativePlayerRateInput = Schema.Struct({
  identity: NativePlayerPlaybackIdentity,
  playbackRate: Positive,
});
export type NativePlayerRateInputEncoded = typeof NativePlayerRateInput.Encoded;

const NativePlayerEventEnvelope = {
  identity: NativePlayerPlaybackIdentity,
};

export const NativePlayerEvent = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Loading"),
    ...NativePlayerEventEnvelope,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Ready"),
    ...NativePlayerEventEnvelope,
    durationSeconds: NonNegative,
  }),
  Schema.Struct({
    _tag: Schema.Literal("PlaybackChanged"),
    ...NativePlayerEventEnvelope,
    isPlaying: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("TimeChanged"),
    ...NativePlayerEventEnvelope,
    currentTimeSeconds: NonNegative,
    bufferedTimeSeconds: NonNegative,
  }),
  Schema.Struct({
    _tag: Schema.Literal("BufferingChanged"),
    ...NativePlayerEventEnvelope,
    isBuffering: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Seeked"),
    ...NativePlayerEventEnvelope,
    currentTimeSeconds: NonNegative,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Ended"),
    ...NativePlayerEventEnvelope,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Error"),
    ...NativePlayerEventEnvelope,
    message: Schema.String,
  }),
]);
export type NativePlayerEvent = typeof NativePlayerEvent.Type;
export type NativePlayerEventEncoded = typeof NativePlayerEvent.Encoded;

export const NativePlayerStatus = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Unavailable"), reason: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("Idle") }),
  Schema.Struct({
    _tag: Schema.Literal("Loading"),
    identity: NativePlayerPlaybackIdentity,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Ready"),
    identity: NativePlayerPlaybackIdentity,
  }),
]);
export type NativePlayerStatusEncoded = typeof NativePlayerStatus.Encoded;

export type NativePlayerSeekResult = "direct" | "none";

export interface MultiplexDesktopBridge {
  readonly player: {
    readonly getStatus: () => Promise<NativePlayerStatusEncoded>;
    readonly load: (input: NativePlayerLoadInputEncoded) => Promise<void>;
    readonly play: (identity: NativePlayerPlaybackIdentityEncoded) => Promise<boolean>;
    readonly pause: (identity: NativePlayerPlaybackIdentityEncoded) => Promise<void>;
    readonly seek: (input: NativePlayerSeekInputEncoded) => NativePlayerSeekResult;
    readonly present: (surface: NativeVideoSurfaceEncoded) => Promise<void>;
    readonly setVolume: (input: NativePlayerVolumeInputEncoded) => Promise<void>;
    readonly setRate: (input: NativePlayerRateInputEncoded) => Promise<void>;
    readonly stop: (identity: NativePlayerPlaybackIdentityEncoded) => Promise<void>;
    readonly onEvent: (listener: (event: NativePlayerEventEncoded) => void) => () => void;
  };
}
