---
name: effect-typed-errors
description: Fix lint findings that use untyped JavaScript error handling instead of Effect typed failures. Use when lint flags new Error, throw, try/catch, Promise.catch, Promise.reject, instanceof Error, unknown error message/stringification, redundant helpers that only construct tagged errors, or Effect.runPromise/runSync/runFork/runPromiseExit outside designated boundaries.
allowed-tools: Read Grep Glob Bash
---

You fix one family of patterns: untyped JavaScript error handling in Effect code, and Effect runtime escape hatches (`Effect.runPromise` / `runSync` / `runFork` / `runPromiseExit`) used outside designated boundary files.

The preferred boundary is typed `Schema.TaggedError` / `Data.TaggedError` values in the Effect error channel. Construct the tagged error directly at the failure site unless a helper performs real classification or normalization.

Keep Effect values in the Effect world. The oxlint rule `multiplex/no-effect-escape-hatch` flags `Effect.run*` outside scripts, `apps/web/src/lib/effect/**`, and similarly designated boundary globs (see root `.oxlintrc.json`). Prefer letting `@effect/atom-react`, a scoped runtime, or a single bootstrap module drive execution.

## Trace before changing

1. **Identify the boundary.** Is this Effect domain code, React UI code, a third-party callback, or plain test/tooling code?
2. **Find the existing domain errors.** Check nearby `errors.ts`, `Schema.TaggedError`, `Data.TaggedError`, and API `.addError(...)` declarations before adding a new class.
3. **Decide whether a new error is needed.** Add a new tagged error only if callers have a distinct recovery path, HTTP status, UI affordance, retry policy, or telemetry classification.
4. **Preserve failure semantics.** If the old code failed, the new code should fail in the Effect error channel. Do not replace thrown failures with fallback values like `false`, `null`, `undefined`, `[]`, or `"unknown"` unless the existing contract already treats that condition as non-fatal.
5. **Preserve the typed channel.** Do not convert typed failures into `Error`, thrown exceptions, `String(error)`, or `.message` reads from unknown values.
6. **Recognize real boundaries.** Runtime workers, Vite/CLI tooling, callback APIs, and third-party interfaces may have to throw, catch, reject, or `Effect.run*` at the boundary. Do not contort those files into fake Effect shapes. Keep the boundary idiom when it is contained and immediately wrapped into an Effect error channel, stable IPC envelope, or test/tooling result.
7. **Do not hide construction behind trivial helpers.** Inline `new DomainError(...)` unless the helper branches on input or maps an external error format into a domain error.

## Preserve behavior first

The lint rule is about **where the failure lives**, not whether the operation should still fail.

Bad fix: this removes the lint finding by silently changing invalid input into a non-match.

```ts
case "in":
  if (!Array.isArray(value)) return false;
  return value.some((v) => cmp(lhs, v));
```

Good fix: keep the invalid input as a failure, but make it typed.

```ts
case "in":
  if (!Array.isArray(value)) {
    return Effect.fail(
      new StorageError({ message: "Value must be an array", cause: clause }),
    );
  }
  return Effect.succeed(value.some((v) => cmp(lhs, v)));
```

When the containing helper was synchronous, make the helper return `Effect.Effect<Success, DomainError>` and thread that through callers. Do not collapse the error into a success value to avoid changing call sites.

## Boundary exceptions

The lint rule is not a mandate to make every file Effect-shaped. It is acceptable to keep `try/catch`, `throw`, `new Error`, `.catch`, `String(error)`, or `Effect.run*` at a true adapter boundary when all of these are true:

- the surrounding API is inherently throwing, callback-based, Promise-based, process/IPC-based, or plain JS tooling
- the untyped behavior is contained to the boundary function or module
- control is immediately translated into a typed Effect failure, stable IPC payload, stable test assertion, or deliberately best-effort cleanup
- the suppression is narrow and explains the boundary

## Repo Effect API compatibility

Use the APIs that exist in this repo's pinned Effect runtime (catalog `effect@4.0.0-beta.x`):

- Use `Effect.callback` for callback adapters. Do not use `Effect.async`.
- Use `Effect.andThen` or `Effect.gen` sequencing. Do not use `Effect.zipRight`.
- Use `Effect.timeoutOrElse` or `Effect.timeoutOption`. Do not use `Effect.timeoutFail`.

These are not style preferences; the unavailable APIs fail at typecheck or runtime.

Good boundary suppression:

```ts
// oxlint-disable-next-line multiplex/no-effect-escape-hatch -- boundary: bootstrap runs the root fiber once
const fiber = Effect.runFork(program);
```

```ts
// eslint-disable-next-line no-restricted-syntax -- boundary: JSON.parse feeds stable failure envelope
try {
  const message = JSON.parse(line);
  handleHostMessage(message);
} catch (error) {
  reportBoundaryFailure(error);
}
```

Bad boundary fix: do not replace natural boundary code with fake thenables, fake error objects, promise chains that emulate `try/catch`, or broad helper machinery solely to make lint pass.

## Coverage note

`multiplex/no-effect-escape-hatch` is enforced by oxlint on packages and scripts. Root lint ignores `apps/web/**` for oxlint (that tree uses ESLint). Prefer putting any intentional `Effect.run*` for the web app under `apps/web/src/lib/effect/` (listed as an override) so the convention stays obvious even before ESLint coverage lands.

## Related skills

- React/effect-atom mutation handlers using `try/catch`; use `effect-promise-exit` for that UI-specific boundary.
- Schema / unknown probing; use `effect-schema-boundaries`.
- vitest / `@effect/vitest` imports; unit tests stay on `bun:test` (see `effect-bun-tests`).
