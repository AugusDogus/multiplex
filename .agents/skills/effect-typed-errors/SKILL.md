---
name: effect-typed-errors
description: Fix lint findings that use untyped JavaScript error handling instead of Effect typed failures. Use when lint flags new Error, throw, try/catch, Promise.catch, Promise.reject, instanceof Error, unknown error message/stringification, redundant helpers that only construct tagged errors, or Effect.runPromise/runSync/runFork/runPromiseExit outside designated boundaries.
allowed-tools: Read Grep Glob Bash
---

You fix one family of patterns: untyped JavaScript error handling in Effect
code, and Effect runtime escape hatches used outside designated boundary files.

The preferred boundary is typed `Schema.TaggedError` / `Data.TaggedError`
values in the Effect error channel. Construct the tagged error directly at the
failure site unless a helper performs real classification or normalization.

Keep Effect values in the Effect world. The oxlint rule
`multiplex/no-effect-escape-hatch` flags `Effect.runPromise` / `runSync` /
`runFork` / `runPromiseExit` outside scripts, `apps/web/src/lib/effect/**`,
test files, and similarly designated boundary globs (see root
`.oxlintrc.json`). Prefer letting the session runtime
(`session-atoms.ts`), `@effect/atom-react`, or a single bootstrap module drive
execution.

## Trace before changing

1. **Identify the boundary.** Is this Effect domain code, React UI code, a
   third-party callback (WebSocket events, video element events, Plex SDK
   fetches), a tRPC procedure, or plain test/tooling code?
2. **Find the existing domain errors.** Check nearby error classes
   (`WatchTogetherApiError` in `apps/web/src/lib/effect/watch-together-api.ts`
   is the template) before adding a new one.
3. **Decide whether a new error is needed.** Add a new tagged error only if
   callers have a distinct recovery path, HTTP status, UI affordance, retry
   policy, or telemetry classification.
4. **Preserve failure semantics.** If the old code failed, the new code should
   fail in the Effect error channel. Do not replace thrown failures with
   fallback values like `false`, `null`, `undefined`, `[]`, or `"unknown"`
   unless the existing contract already treats that condition as non-fatal.
5. **Preserve the typed channel.** Do not convert typed failures into `Error`,
   thrown exceptions, `String(error)`, or `.message` reads from unknown values.
6. **Recognize real boundaries.** Browser/callback APIs (video element,
   `WebSocket`, timers), Next.js server entry points, and third-party
   interfaces may have to throw, catch, reject, or `Effect.run*` at the
   boundary. Do not contort those files into fake Effect shapes. Keep the
   boundary idiom when it is contained and immediately wrapped into an Effect
   error channel or a stable test/tooling result.
7. **Do not hide construction behind trivial helpers.** Inline
   `new DomainError(...)` unless the helper branches on input or maps an
   external error format into a domain error.

## Preserve behavior first

The finding is about **where the failure lives**, not whether the operation
should still fail.

Bad fix: this removes the finding by silently changing invalid input into a
non-match.

```ts
if (!Array.isArray(value)) return false;
return value.some((v) => matches(lhs, v));
```

Good fix: keep the invalid input as a failure, but make it typed.

```ts
if (!Array.isArray(value)) {
  return Effect.fail(
    new PlexResponseError({ message: "Value must be an array", cause: value }),
  );
}
return Effect.succeed(value.some((v) => matches(lhs, v)));
```

When the containing helper was synchronous, make the helper return
`Effect.Effect<Success, DomainError>` and thread that through callers. Do not
collapse the error into a success value to avoid changing call sites.

## Boundary exceptions

This is not a mandate to make every file Effect-shaped. It is acceptable to
keep `try/catch`, `throw`, `new Error`, `.catch`, `String(error)`, or
`Effect.run*` at a true adapter boundary when all of these are true:

- the surrounding API is inherently throwing, callback-based, Promise-based,
  or plain JS tooling (video element events, Syncplay socket callbacks,
  Next.js route handlers, scripts)
- the untyped behavior is contained to the boundary function or module
- control is immediately translated into a typed Effect failure, a stable test
  assertion, or deliberately best-effort cleanup
- any lint suppression is narrow and explains the boundary

For Effect domain code, fix the code. For boundary code, either wrap once with
`Effect.try` / `Effect.tryPromise` at the entry point or use a narrow
suppression with a `boundary:` reason.

## Repo Effect API compatibility (v4 beta pin)

Use the APIs that exist in this repo's pinned Effect runtime
(`effect@4.0.0-beta.59`; see also the v4 notes in code comments under
`apps/web/src/lib/effect/`):

- Use `Effect.callback` for callback adapters. Do not use `Effect.async`.
- Use `Effect.andThen` or `Effect.gen` sequencing. Do not use `Effect.zipRight`.
- Use `Effect.timeoutOrElse` or `Effect.timeoutOption`. Do not use `Effect.timeoutFail`.
- Use `Context.Service` + static layers. Do not use `Effect.Service`.
- Use `Effect.forkDetach` / `Effect.forkScoped`. Do not use `Effect.fork`.

These are not style preferences; the unavailable APIs fail at typecheck or
runtime.

## Fix shapes

### Throw / new Error

Bad:

```ts
throw new Error("Missing room");
```

Good in `Effect.gen`:

```ts
return yield* new RoomNotFoundError({ roomId });
```

Good in combinators:

```ts
Effect.fail(new RoomNotFoundError({ roomId }));
```

Prefer yielding the error directly in generator code; do not write
`yield* Effect.fail(...)` inside generators.

### Promise.catch / Promise.reject

Bad:

```ts
await client.deleteRoom(roomId).catch(() => {});
return Promise.reject(new Error("failed"));
```

Good:

```ts
Effect.tryPromise({
  try: () => client.deleteRoom(roomId),
  catch: (cause) => new WatchTogetherApiError({ operation: "deleteRoom", cause }),
});
```

If the failure is intentionally ignored (best-effort cleanup like stopping a
transcode session), wrap with `Effect.ignore(...)` so the intent is explicit.

### Effect die / orDie escape hatches

`Effect.die`, `Effect.dieMessage`, `Effect.orDie`, and `Effect.orDieWith` turn
typed failures into defects. Use them only at a true runtime boundary where
the host cannot represent typed failures. Do not use `orDie` to avoid
threading an error type through normal Effect code; use
`Effect.mapError((cause) => new DomainError({ ... , cause }))`.

### try/catch

Bad:

```ts
try {
  return JSON.parse(text);
} catch (cause) {
  return new ParseError({ message: String(cause) });
}
```

Good for schema-backed input:

```ts
Schema.decodeUnknownEffect(Schema.fromJsonString(InputSchema))(text).pipe(
  Effect.mapError(() => new ParseError({ message: "Failed to parse input" })),
);
```

Good for non-schema throwing APIs:

```ts
Effect.try({
  try: () => new URL(value),
  catch: (cause) => new UrlParseError({ value, cause }),
});
```

### Unknown error message / instanceof Error

Bad:

```ts
err instanceof Error ? err.message : String(err);
```

Also bad: destructuring `message` only hides the same unknown-state problem.

Prefer one of:

```ts
Effect.mapError((err) => new DomainError({ cause: err }));
```

```ts
Effect.catchTag("WatchTogetherApiError", (err) =>
  Effect.fail(new SessionError({ message: "Room request failed" })),
);
```

Only read `.message` from a typed error union when that field is explicitly
part of the user-facing contract. Most boundary errors should use a stable
product message ("Unable to load video") and keep the original value in a
separate `cause`, log, or telemetry channel. Do not inspect unknown thrown
values for domain behavior or user-facing copy.

### Manual tags and broad error laundering

Bad: manually probing `_tag` to recover from typed Effect failures.

```ts
Effect.mapError((err) =>
  "_tag" in err && err._tag === "WatchTogetherApiError"
    ? new SessionError({ message: "Room request failed" })
    : err,
);
```

Good: catch the one typed case you intentionally translate.

```ts
effect.pipe(
  Effect.catchTag("WatchTogetherApiError", () =>
    Effect.fail(new SessionError({ message: "Room request failed" })),
  ),
);
```

Do not wrap a typed error union into one local error only to satisfy a
narrower helper signature; widen the helper's error channel when callers can
still use the original typed failure. For Effect data types, use public
helpers (`Option.isNone(...)`, `Exit.isFailure(...)`) instead of `_tag`
checks.

### Redundant error helpers

Bad:

```ts
const apiError = (message: string) =>
  new WatchTogetherApiError({ operation: "listRooms", message });

return yield* apiError("Request failed");
```

Good: construct inline. Helpers are allowed only when they do real work:
choosing between different tagged errors, decoding an external error shape,
preserving protocol-specific fields, or normalizing a third-party SDK failure
into one domain error.

## New error or existing error?

Reuse an existing tagged error when only the message changes. Create a new
tagged error when a caller can reasonably branch differently:

- different HTTP status
- retry vs no retry
- auth/sign-in affordance
- not-found vs conflict vs validation
- user-actionable vs internal failure
- different telemetry grouping that should not depend on message text

Do not create one tagged error per sentence of prose.

## What not to report

- Test assertions that intentionally construct errors as fixture values, and
  `Effect.runPromise`/`runSync` in test files (tests are a designated
  boundary; see `effect-bun-tests`).
- Adapter edges that must satisfy a third-party throwing/callback API (video
  element, `WebSocket`, browser APIs), as long as the untyped behavior is
  contained and converted to a typed Effect failure or stable envelope.
- Real normalization helpers that inspect protocol fields and preserve
  structured semantics.
- React/effect-atom mutation handlers using `try/catch`; use
  `effect-promise-exit` for that UI-specific boundary.
- Non-Effect code that has not been migrated (tRPC routers, Zustand player
  store, existing React hooks) — this skill applies to Effect code and to new
  code entering the Effect world, not as a mandate to rewrite untouched
  subsystems.

## Output requirements

When reviewing, report:

- **File and line** of the untyped error pattern.
- **Rule** being violated.
- **Existing domain error** to use, or the new tagged error that should exist.
- **Fix** in the relevant shape: direct `yield* new ErrorType(...)`,
  `Effect.tryPromise`, schema decode, or direct constructor inline.

When editing, keep the error type precise and avoid broad message parsing.
