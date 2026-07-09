---
name: effect-bun-tests
description: Keep tests deterministic and Effect-aware under bun:test. Use when writing or migrating Effect unit tests, or when review flags real sleeps in timer tests or conditional assertions inside tests.
allowed-tools: Read Grep Glob Bash
---

All unit tests in this repo run under `bun test` (`bun:test`), including
Effect-domain and Effect-service suites. Do not add vitest or `@effect/vitest`.

## Fix Shape

- Import `describe`, `it`/`test`, `expect`, `mock`, `spyOn` from `bun:test`.
- Run an Effect under test with `await Effect.runPromise(effect)` (tests are a
  designated boundary for `Effect.runPromise`; the escape-hatch lint rule
  exempts test files).
- For timer/schedule behavior, provide `TestClock.layer()` from
  `effect/testing` and drive time with `TestClock.adjust(...)` instead of real
  sleeps:

```ts
import { Effect } from "effect";
import { TestClock } from "effect/testing";

test("staggers creation by rank", async () => {
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(programUnderTest);
      yield* TestClock.adjust("9.5 seconds");
      // assert observable state here
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
```

- Do not put `expect(...)` behind `if`, ternary, logical, or switch branches.
- Split conditional behavior into separate tests, or assert the branch
  condition and expected value explicitly.
- Run unit tests with `bun run test` from the root or `bun test` inside a
  package. Playwright e2e specs (`apps/web/e2e`) are excluded from `bun test`
  by `apps/web/bunfig.toml` (`root = "src"`); never run them with bun.

## Bad

```ts
if (result.ok) {
  expect(result.value).toBe("x");
}
```

## Good

```ts
expect(result).toEqual({ ok: true, value: "x" });
```
