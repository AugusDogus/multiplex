import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

export interface DesktopIpcInvokeEvent {
  readonly senderFrame: { readonly url: string } | null;
}

export interface DesktopIpcSyncEvent extends DesktopIpcInvokeEvent {
  returnValue: unknown;
}

export type DesktopIpcHandleListener = (
  event: DesktopIpcInvokeEvent,
  raw: unknown,
) => unknown | Promise<unknown>;
export type DesktopIpcSyncListener = (event: DesktopIpcSyncEvent, raw: unknown) => void;

export interface DesktopIpcMain {
  removeHandler(channel: string): void;
  handle(channel: string, listener: DesktopIpcHandleListener): void;
  removeAllListeners(channel: string): void;
  on(channel: string, listener: DesktopIpcSyncListener): void;
}

export class DesktopIpcRegistrationError extends Schema.TaggedError<DesktopIpcRegistrationError>()(
  "DesktopIpcRegistrationError",
  {
    handlerKind: Schema.Literals(["invoke", "sync"]),
    channel: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to register the ${this.handlerKind} IPC handler for ${this.channel}.`;
  }
}

export class DesktopIpcSenderError extends Schema.TaggedError<DesktopIpcSenderError>()(
  "DesktopIpcSenderError",
  {
    channel: Schema.String,
    expectedOrigin: Schema.String,
    senderUrl: Schema.NullOr(Schema.String),
  },
) {
  override get message(): string {
    return `Rejected IPC ${this.channel} from an untrusted renderer.`;
  }
}

export interface DesktopIpcMethod<E> {
  readonly channel: string;
  readonly handler: (raw: unknown) => Effect.Effect<unknown, E>;
}

export interface DesktopSyncIpcMethod<E> {
  readonly channel: string;
  readonly fallback: unknown;
  readonly handler: (raw: unknown) => Effect.Effect<unknown, E>;
}

export class DesktopIpc extends Context.Service<
  DesktopIpc,
  {
    readonly handle: <E>(
      method: DesktopIpcMethod<E>,
      expectedOrigin: string,
    ) => Effect.Effect<void, DesktopIpcRegistrationError, Scope.Scope>;
    readonly handleSync: <E>(
      method: DesktopSyncIpcMethod<E>,
      expectedOrigin: string,
    ) => Effect.Effect<void, DesktopIpcRegistrationError, Scope.Scope>;
  }
>()("@multiplex/desktop/ipc/DesktopIpc") {}

const senderIsTrusted = (event: DesktopIpcInvokeEvent, expectedOrigin: string): boolean => {
  if (event.senderFrame === null) return false;
  try {
    const sender = new URL(event.senderFrame.url);
    const expected = new URL(expectedOrigin);
    return (
      sender.protocol === expected.protocol &&
      sender.hostname === expected.hostname &&
      sender.port === expected.port
    );
  } catch {
    return false;
  }
};

export const make = (ipcMain: DesktopIpcMain): DesktopIpc["Service"] =>
  DesktopIpc.of({
    handle: (method, expectedOrigin) =>
      Effect.acquireRelease(
        Effect.try({
          try: () => {
            ipcMain.removeHandler(method.channel);
            ipcMain.handle(method.channel, (event, raw) => {
              if (!senderIsTrusted(event, expectedOrigin)) {
                return Promise.reject(
                  new DesktopIpcSenderError({
                    channel: method.channel,
                    expectedOrigin,
                    senderUrl: event.senderFrame?.url ?? null,
                  }),
                );
              }
              return Effect.runPromise(method.handler(raw));
            });
          },
          catch: (cause) =>
            new DesktopIpcRegistrationError({
              handlerKind: "invoke",
              channel: method.channel,
              cause,
            }),
        }),
        () => Effect.sync(() => ipcMain.removeHandler(method.channel)),
      ).pipe(Effect.asVoid),
    handleSync: (method, expectedOrigin) =>
      Effect.acquireRelease(
        Effect.try({
          try: () => {
            ipcMain.removeAllListeners(method.channel);
            ipcMain.on(method.channel, (event, raw) => {
              if (!senderIsTrusted(event, expectedOrigin)) {
                event.returnValue = method.fallback;
                return;
              }
              event.returnValue = Effect.runSync(method.handler(raw));
            });
          },
          catch: (cause) =>
            new DesktopIpcRegistrationError({
              handlerKind: "sync",
              channel: method.channel,
              cause,
            }),
        }),
        () => Effect.sync(() => ipcMain.removeAllListeners(method.channel)),
      ).pipe(Effect.asVoid),
  });

export const layer = (ipcMain: DesktopIpcMain) => Layer.succeed(DesktopIpc, make(ipcMain));

export const makeIpcMethod = <Payload, EncodedPayload, Result, EncodedResult, E>(input: {
  readonly channel: string;
  readonly payload: Schema.Codec<Payload, EncodedPayload>;
  readonly result: Schema.Codec<Result, EncodedResult>;
  readonly handler: (payload: Payload) => Effect.Effect<Result, E>;
}): DesktopIpcMethod<E | Schema.SchemaError> => {
  const decode = Schema.decodeUnknownEffect(input.payload);
  const encode = Schema.encodeUnknownEffect(input.result);
  return {
    channel: input.channel,
    handler: (raw) => decode(raw).pipe(Effect.flatMap(input.handler), Effect.flatMap(encode)),
  };
};

export const makeSyncIpcMethod = <Payload, EncodedPayload, Result, EncodedResult, E>(input: {
  readonly channel: string;
  readonly payload: Schema.Codec<Payload, EncodedPayload>;
  readonly result: Schema.Codec<Result, EncodedResult>;
  readonly fallback: EncodedResult;
  readonly handler: (payload: Payload) => Effect.Effect<Result, E>;
}): DesktopSyncIpcMethod<E | Schema.SchemaError> => {
  const decode = Schema.decodeUnknownEffect(input.payload);
  const encode = Schema.encodeUnknownEffect(input.result);
  return {
    channel: input.channel,
    fallback: input.fallback,
    handler: (raw) => decode(raw).pipe(Effect.flatMap(input.handler), Effect.flatMap(encode)),
  };
};
