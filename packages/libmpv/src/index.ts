import { createRequire } from "node:module";
import { join } from "node:path";

export type LibmpvEvent =
  | {
      readonly _tag: "FileLoaded";
      readonly sourceGeneration: number;
      readonly durationSeconds: number;
    }
  | {
      readonly _tag: "PlaybackChanged";
      readonly sourceGeneration: number;
      readonly isPlaying: boolean;
    }
  | {
      readonly _tag: "TimeChanged";
      readonly sourceGeneration: number;
      readonly currentTimeSeconds: number;
      readonly bufferedTimeSeconds: number;
    }
  | {
      readonly _tag: "BufferingChanged";
      readonly sourceGeneration: number;
      readonly isBuffering: boolean;
    }
  | {
      readonly _tag: "Seeked";
      readonly sourceGeneration: number;
      readonly currentTimeSeconds: number;
    }
  | { readonly _tag: "Ended"; readonly sourceGeneration: number }
  | {
      readonly _tag: "Error";
      readonly sourceGeneration: number;
      readonly message: string;
    };

export interface LibmpvLoadOptions {
  readonly sourceGeneration: number;
  readonly url: string;
  readonly title: string;
  readonly startSeconds: number;
  readonly volume: number;
  readonly muted: boolean;
  readonly playbackRate: number;
}

export type LibmpvSurface =
  | { readonly _tag: "Hidden" }
  | {
      readonly _tag: "Visible";
      readonly ownerHandle: Buffer;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly deviceScaleFactor: number;
    };

export interface LibmpvPlayer {
  readonly load: (options: LibmpvLoadOptions) => void;
  readonly play: () => void;
  readonly pause: () => void;
  readonly seek: (seconds: number) => void;
  readonly setVolume: (volume: number, muted: boolean) => void;
  readonly setRate: (playbackRate: number) => void;
  readonly present: (surface: LibmpvSurface) => void;
  readonly stop: () => void;
  readonly dispose: () => void;
}

interface LibmpvBinding {
  readonly createPlayer: (onEvent: (event: LibmpvEvent) => void) => LibmpvPlayer;
}

const require = createRequire(import.meta.url);

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const decodeEvent = (value: unknown): LibmpvEvent | null => {
  if (!isRecord(value)) return null;
  const tag = value._tag;
  const sourceGeneration = value.sourceGeneration;
  if (typeof tag !== "string" || typeof sourceGeneration !== "number") {
    return null;
  }
  switch (tag) {
    case "FileLoaded":
      return typeof value.durationSeconds === "number"
        ? { _tag: tag, sourceGeneration, durationSeconds: value.durationSeconds }
        : null;
    case "PlaybackChanged":
      return typeof value.isPlaying === "boolean"
        ? { _tag: tag, sourceGeneration, isPlaying: value.isPlaying }
        : null;
    case "TimeChanged":
      return typeof value.currentTimeSeconds === "number" &&
        typeof value.bufferedTimeSeconds === "number"
        ? {
            _tag: tag,
            sourceGeneration,
            currentTimeSeconds: value.currentTimeSeconds,
            bufferedTimeSeconds: value.bufferedTimeSeconds,
          }
        : null;
    case "BufferingChanged":
      return typeof value.isBuffering === "boolean"
        ? { _tag: tag, sourceGeneration, isBuffering: value.isBuffering }
        : null;
    case "Seeked":
      return typeof value.currentTimeSeconds === "number"
        ? { _tag: tag, sourceGeneration, currentTimeSeconds: value.currentTimeSeconds }
        : null;
    case "Ended":
      return { _tag: tag, sourceGeneration };
    case "Error":
      return typeof value.message === "string"
        ? { _tag: tag, sourceGeneration, message: value.message }
        : null;
    default:
      return null;
  }
};

const isNativePlayer = (value: unknown): value is LibmpvPlayer =>
  isRecord(value) &&
  typeof value.load === "function" &&
  typeof value.play === "function" &&
  typeof value.pause === "function" &&
  typeof value.seek === "function" &&
  typeof value.setVolume === "function" &&
  typeof value.setRate === "function" &&
  typeof value.present === "function" &&
  typeof value.stop === "function" &&
  typeof value.dispose === "function";

const isNativeBinding = (
  value: unknown,
): value is {
  readonly createPlayer: (onEvent: (event: unknown) => void) => unknown;
} => isRecord(value) && typeof value.createPlayer === "function";

const resolveBindingPath = (bindingPath?: string): string => {
  if (bindingPath) return bindingPath;
  const explicitPath = process.env.MULTIPLEX_LIBMPV_ADDON_PATH;
  if (explicitPath) return explicitPath;

  return join(import.meta.dirname, "..", "build", "Release", "multiplex_libmpv.node");
};

export const loadLibmpvBinding = (bindingPath?: string): LibmpvBinding => {
  const nativeBinding: unknown = require(resolveBindingPath(bindingPath));
  if (!isNativeBinding(nativeBinding)) {
    throw new TypeError("The Multiplex libmpv addon has an invalid module shape.");
  }

  return {
    createPlayer: (onEvent) => {
      const nativePlayer = nativeBinding.createPlayer((rawEvent) => {
        const event = decodeEvent(rawEvent);
        if (event) onEvent(event);
      });
      if (!isNativePlayer(nativePlayer)) {
        throw new TypeError("The Multiplex libmpv addon returned an invalid player.");
      }
      return nativePlayer;
    },
  };
};
