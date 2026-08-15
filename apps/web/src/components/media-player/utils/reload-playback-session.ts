import { Option, Schema } from "effect";

import type { MediaPlayerItem } from "~/types/media-player";

const STORAGE_KEY = "multiplex:reload-playback-session";
const MAX_RELOAD_SESSION_AGE_MS = 60_000;

const ReloadPlaybackSessionSchema = Schema.fromJsonString(
  Schema.Struct({
    serverId: Schema.String,
    ratingKey: Schema.String,
    streamSessionId: Schema.String,
    transcodeSessionId: Schema.String,
    streamOffset: Schema.Number,
    transcodeAttempt: Schema.Number,
    savedAt: Schema.Number,
  }),
);

export interface ReloadPlaybackSession {
  readonly serverId: string;
  readonly ratingKey: string;
  readonly streamSessionId: string;
  readonly transcodeSessionId: string;
  readonly streamOffset: number;
  readonly transcodeAttempt: number;
  readonly savedAt: number;
}

interface PlaybackSessionStorage {
  readonly getItem: (key: string) => string | null;
  readonly removeItem: (key: string) => void;
  readonly setItem: (key: string, value: string) => void;
}

export function storeReloadPlaybackSession(
  storage: PlaybackSessionStorage,
  session: ReloadPlaybackSession,
): boolean {
  const encoded = Option.getOrNull(
    Schema.encodeOption(ReloadPlaybackSessionSchema)(session),
  );
  if (encoded === null) return false;

  return Option.isSome(
    Option.liftThrowable(() => storage.setItem(STORAGE_KEY, encoded))(),
  );
}

export function consumeReloadPlaybackSession(
  storage: PlaybackSessionStorage,
  item: Pick<MediaPlayerItem, "serverId" | "ratingKey">,
  now = Date.now(),
): ReloadPlaybackSession | null {
  const raw = Option.getOrNull(
    Option.liftThrowable(() => storage.getItem(STORAGE_KEY))(),
  );
  Option.liftThrowable(() => storage.removeItem(STORAGE_KEY))();
  if (raw === null) return null;

  const session = Option.getOrNull(
    Schema.decodeUnknownOption(ReloadPlaybackSessionSchema)(raw),
  );
  if (session === null) return null;

  if (
    session.serverId !== item.serverId ||
    session.ratingKey !== item.ratingKey ||
    session.streamSessionId.length === 0 ||
    session.transcodeSessionId.length === 0 ||
    !Number.isFinite(session.streamOffset) ||
    session.streamOffset < 0 ||
    !Number.isInteger(session.transcodeAttempt) ||
    session.transcodeAttempt < 0 ||
    !Number.isFinite(session.savedAt) ||
    now - session.savedAt < 0 ||
    now - session.savedAt > MAX_RELOAD_SESSION_AGE_MS
  ) {
    return null;
  }

  return session;
}

export function browserReloadStorage(): Storage | null {
  return typeof window === "undefined"
    ? null
    : Option.getOrNull(Option.liftThrowable(() => window.localStorage)());
}
