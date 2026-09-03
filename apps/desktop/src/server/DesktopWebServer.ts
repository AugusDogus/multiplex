import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

const DesktopWebServerOperation = Schema.Literals([
  "allocate-port",
  "prepare-state",
  "start-process",
  "wait-for-readiness",
]);

export class DesktopWebServerError extends Schema.TaggedError<DesktopWebServerError>()(
  "DesktopWebServerError",
  {
    operation: DesktopWebServerOperation,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `The desktop web server failed during ${this.operation}.`;
  }
}

export class DesktopWebServer extends Context.Service<
  DesktopWebServer,
  { readonly origin: URL; readonly stop: Effect.Effect<void> }
>()("@multiplex/desktop/server/DesktopWebServer") {}

const allocatePort = Effect.callback<number, DesktopWebServerError>((resume) => {
  const server = createServer();
  server.once("error", (cause) =>
    resume(Effect.fail(new DesktopWebServerError({ operation: "allocate-port", cause }))),
  );
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (typeof address === "object" && address !== null) {
      const port = address.port;
      server.close(() => resume(Effect.succeed(port)));
      return;
    }
    server.close(() =>
      resume(
        Effect.fail(
          new DesktopWebServerError({
            operation: "allocate-port",
            cause: "The operating system did not return a TCP port.",
          }),
        ),
      ),
    );
  });
});

const resolveAuthSecret = (stateDirectory: string) =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(stateDirectory, { recursive: true });
      const secretPath = join(stateDirectory, "better-auth-secret");
      try {
        return (await readFile(secretPath, "utf8")).trim();
      } catch (cause) {
        const missing = cause instanceof Error && "code" in cause && cause.code === "ENOENT";
        if (!missing) throw cause;
        const secret = randomBytes(32).toString("hex");
        await writeFile(secretPath, secret, { encoding: "utf8", mode: 0o600 });
        return secret;
      }
    },
    catch: (cause) => new DesktopWebServerError({ operation: "prepare-state", cause }),
  });

const waitUntilReady = (origin: URL) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status >= 500) {
        throw new Error(`Readiness returned HTTP ${response.status}.`);
      }
    },
    catch: (cause) => new DesktopWebServerError({ operation: "wait-for-readiness", cause }),
  }).pipe(
    Effect.retry(Schedule.recurs(600).pipe(Schedule.addDelay(() => Effect.succeed("100 millis")))),
  );

const startPackagedServer = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const port = yield* allocatePort;
  const origin = new URL(`http://127.0.0.1:${port}/`);
  const authSecret = yield* resolveAuthSecret(environment.stateDirectory);
  const databasePath = join(environment.stateDirectory, "multiplex.sqlite");

  const stopChild = (running: ReturnType<typeof spawn>) =>
    Effect.sync(() => {
      if (running.exitCode === null) running.kill("SIGTERM");
    });
  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        spawn(process.execPath, [environment.webServerEntryPath], {
          cwd: environment.stateDirectory,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            HOSTNAME: "127.0.0.1",
            PORT: String(port),
            BETTER_AUTH_URL: environment.rendererOrigin.href,
            BETTER_AUTH_SECRET: authSecret,
            DATABASE_URL: `file:${databasePath}`,
          },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        }),
      catch: (cause) => new DesktopWebServerError({ operation: "start-process", cause }),
    }),
    stopChild,
  );

  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  yield* waitUntilReady(origin);
  return DesktopWebServer.of({ origin, stop: stopChild(child) });
});

export const layer = Layer.effect(
  DesktopWebServer,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    if (environment.developmentServerUrl) {
      return DesktopWebServer.of({
        origin: environment.developmentServerUrl,
        stop: Effect.void,
      });
    }
    return yield* startPackagedServer;
  }),
);
