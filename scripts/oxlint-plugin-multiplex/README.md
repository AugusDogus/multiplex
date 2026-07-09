# oxlint-plugin-multiplex

Custom oxlint JS plugin for Multiplex Effect v4 conventions.

## Rules

### `multiplex/no-effect-escape-hatch`

Flags `Effect.runPromise`, `Effect.runSync`, `Effect.runFork`, and
`Effect.runPromiseExit` outside designated boundary files.

Keep Effect values in the Effect world. Run them only at a narrow runtime edge
(CLI/scripts, a future `apps/web/src/lib/effect/` runtime bootstrap, or similar).
Tests are exempt via the rule's `isTestLike` check; additional boundary globs
are listed as `overrides` in the root `.oxlintrc.json`.

**Deviation from executor:** executor's identically-named rule flags
`die` / `orDie` / `dieMessage` / `orDieWith`. Multiplex's phase-0 rule follows
the migration plan and targets the `run*` runners instead.

## Coverage

Root `bun run lint` runs oxlint as:

```bash
oxlint --ignore-pattern 'apps/web/**' .
```

So this plugin currently covers `packages/**` and `scripts/**` (and anything
else outside `apps/web`). `apps/web` is linted by ESLint, not oxlint — the
escape-hatch rule does **not** apply there until oxlint is extended to that
tree or an equivalent ESLint rule is added.

## Wiring

Registered from the repo root `.oxlintrc.json` via experimental `jsPlugins`:

```json
"jsPlugins": [{ "name": "multiplex", "specifier": "./scripts/oxlint-plugin-multiplex.mjs" }]
```
