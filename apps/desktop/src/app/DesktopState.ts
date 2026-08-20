import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export class DesktopState extends Context.Service<
  DesktopState,
  {
    readonly quitting: Ref.Ref<boolean>;
  }
>()("@multiplex/desktop/app/DesktopState") {}

export const layer = Layer.effect(
  DesktopState,
  Effect.gen(function* () {
    return DesktopState.of({ quitting: yield* Ref.make(false) });
  }),
);
