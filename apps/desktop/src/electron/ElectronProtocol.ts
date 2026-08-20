import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { net, protocol } from "electron";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

export const registerRendererSchemes = (): void => {
  protocol.registerSchemesAsPrivileged(
    ["multiplex", "multiplex-dev"].map((scheme) => ({
      scheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    })),
  );
};

export class ElectronProtocolRegistrationError extends Schema.TaggedError<ElectronProtocolRegistrationError>()(
  "ElectronProtocolRegistrationError",
  { scheme: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Electron could not register the ${this.scheme} renderer protocol.`;
  }
}

export class ElectronProtocol extends Context.Service<
  ElectronProtocol,
  {
    readonly register: (
      targetOrigin: URL,
    ) => Effect.Effect<void, ElectronProtocolRegistrationError>;
  }
>()("@multiplex/desktop/electron/ElectronProtocol") {}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;

  return ElectronProtocol.of({
    register: (targetOrigin) =>
      Effect.try({
        try: () =>
          protocol.handle(environment.rendererScheme, async (request) => {
            const incomingUrl = new URL(request.url);
            const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, targetOrigin);
            const baseOptions = {
              method: request.method,
              headers: request.headers,
              redirect: "manual",
            } as const;
            if (request.method === "GET" || request.method === "HEAD") {
              return net.fetch(targetUrl.href, baseOptions);
            }
            const body = Buffer.from(await request.arrayBuffer());
            return net.fetch(targetUrl.href, { ...baseOptions, body });
          }),
        catch: (cause) =>
          new ElectronProtocolRegistrationError({
            scheme: environment.rendererScheme,
            cause,
          }),
      }),
  });
});

export const layer = Layer.effect(ElectronProtocol, make);
