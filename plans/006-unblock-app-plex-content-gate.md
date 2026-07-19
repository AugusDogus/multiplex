# Plan 006: Stop AppPlexContentGate from blocking every page's loading UI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 38dbd82..HEAD -- apps/web/src/app/(app)/layout.tsx apps/web/src/components/app-shell.tsx apps/web/src/server/queries/get-app-plex-context.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: MED (empty-server gate must still show `NoPlexServers`; auth redirect must still work)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `38dbd82`, 2026-07-19

## Why this matters

Every authenticated route under `(app)` is wrapped by `AppPlexContentGate`, which
`await`s `getAppPlexContext()` before rendering `children`. That means page-level
`loading.tsx` skeletons (library, item details, live-tv, hubs) cannot appear
until session + plex.tv servers + userInfo resolve. Home already streams its own
Suspense lanes; the gate undoes that benefit for every soft/hard navigation that
re-renders the layout children slot.

## Current state

- `apps/web/src/app/(app)/layout.tsx` — wraps `{children}` inside
  `Suspense` → `AppPlexContentGate`.
- `apps/web/src/components/app-shell.tsx` — gate only needs `servers.length`.
- `apps/web/src/server/queries/get-app-plex-context.ts` — per-request `cache()`,
  also warms CW/hubs/libraries (good); still a hard await for the gate.

```tsx
// apps/web/src/app/(app)/layout.tsx
<Suspense fallback={<AppContentGateFallback />}>
  <AppPlexContentGate>{children}</AppPlexContentGate>
</Suspense>
```

```tsx
// apps/web/src/components/app-shell.tsx
export async function AppPlexContentGate({ children }: AppPlexContentGateProps) {
  const { servers } = await getAppPlexContext();
  if (servers.length === 0) {
    return <NoPlexServers />;
  }
  return children;
}
```

Sidebar already has its own Suspense lane and separately awaits
`getAllServerLibraries.prefetch()` — do **not** move that into the content path.

## Commands you will need

| Purpose   | Command             | Expected on success      |
| --------- | ------------------- | ------------------------ |
| Install   | `bun install`       | exit 0                   |
| Typecheck | `bun run typecheck` | exit 0                   |
| Lint      | `bun run lint`      | exit 0                   |
| Tests     | `bun run test`      | exit 0 (or scoped tests) |

## Scope

**In scope**:

- `apps/web/src/app/(app)/layout.tsx`
- `apps/web/src/components/app-shell.tsx`
- Optional small helper next to app-shell if needed for a non-blocking empty-server check
- Tests only if an existing layout/shell test file exists; do not invent E2E

**Out of scope**:

- Changing `getAllServerLibraries` caching or sidebar prefetch
- Reworking home Suspense lanes (already done in plan 002)
- Sync engines / client DB

## Git workflow

- Branch: stay on the current working branch (cloud agent); do not create extra branches unless required.
- Commits: Conventional Commits, e.g. `perf(web): stream app pages past plex content gate`
- Do NOT open a PR unless instructed.

## Steps

### Step 1: Restructure so page children are not behind the gate await

Preferred shape (match existing patterns in `page.tsx` home streaming):

1. Render `{children}` immediately inside `AppScrollContainer` (still under
   `(app)` auth layout).
2. Keep an empty-server overlay/replacement that can suspend independently —
   e.g. a sibling Suspense that only shows `NoPlexServers` when servers are
   empty, without delaying the destination `loading.tsx`.
3. Ensure unauthenticated users still `redirect("/login")` via
   `getAppPlexContext` somewhere that runs early (sidebar lane and/or a thin
   auth probe). Do not remove the session check from `getAppPlexContext`.

If a pure sibling overlay cannot replace page content when `servers.length === 0`,
an acceptable alternative is: move the empty-server check into a layout that
streams `children` first and swaps to `NoPlexServers` only after context resolves
**without** wrapping children in the awaiting component. The key invariant:
**awaiting `getAppPlexContext` must not be an ancestor that blocks `{children}`.**

**Verify**: `rg -n "AppPlexContentGate" apps/web/src/app/\(app\)/layout.tsx apps/web/src/components/app-shell.tsx` — children are not rendered only after the gate's await returns.

### Step 2: Preserve NoPlexServers behavior

Manually reason through / add a unit-level assertion if cheap:

- `servers.length === 0` → user sees `NoPlexServers`, not a broken library page.
- `servers.length > 0` → destination `loading.tsx` can paint without waiting on
  media-providers.

**Verify**: `bun run typecheck` → exit 0

### Step 3: Lint

**Verify**: `bun run lint` → exit 0

## Test plan

- No new Playwright required.
- If you can add a focused RSC/unit test around the gate helper without heavy
  Next mocking, do so; otherwise rely on typecheck + manual reasoning in the
  PR description.

## Done criteria

- [ ] `{children}` under `(app)` is not blocked on `await getAppPlexContext()` in an ancestor
- [ ] Empty server list still surfaces `NoPlexServers`
- [ ] `bun run typecheck` and `bun run lint` pass
- [ ] `plans/README.md` status for 006 set to DONE

## STOP conditions

- If Next.js 16 layout APIs make a non-blocking empty-server swap impossible
  without a documented pattern in `apps/web/node_modules/next/dist/docs/`, STOP
  and report with the doc quote — do not invent a client-only gate that races
  auth.
- If removing the gate reintroduces unauthenticated flashes of app chrome, STOP.

## Maintenance

Any new global “must have servers” check must stream beside pages, not wrap them.
Home warm-path work in `getAppPlexContext` (connection warm + CW/hubs warm)
should remain fire-and-forget, not become a content blocker again.
