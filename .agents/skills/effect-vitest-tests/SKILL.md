---
name: effect-vitest-tests
description: Keep tests deterministic and Effect-aware. Use when writing or migrating Effect unit tests, or when review flags raw vitest imports in Effect suites or conditional assertions inside tests.
allowed-tools: Read Grep Glob Bash
---

Use `@effect/vitest` for Effect-domain and Effect-service tests in this repo. Existing non-Effect unit tests may import from `vitest` directly.

## Fix Shape

- For Effect code under test, import `describe`, `it`, `expect`, and helpers from `@effect/vitest`.
- Import utility helpers from `@effect/vitest/utils` when needed.
- Prefer `TestClock` from `@effect/vitest` for timer/schedule behavior instead of real sleeps.
- Do not put `expect(...)` behind `if`, ternary, logical, or switch branches.
- Split conditional behavior into separate tests, or assert the branch condition and expected value explicitly.
- Run unit tests with `bun run test` (workspace vitest) or `bunx vitest run` inside a package. Do not use `bun test` / `bun:test` for new suites.

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
