# Plan 009: Lazy-load MediaPlayerModal off the root layout critical path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 38dbd82..HEAD -- apps/web/src/app/layout.tsx apps/web/src/components/media-player/media-player-modal.tsx apps/web/src/components/media-player/index.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S–M
- **Risk**: MED (play must still open reliably; Watch Together session must still attach)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `38dbd82`, 2026-07-19

## Why this matters

Root layout eagerly imports the full media player modal graph on every page:

```tsx
// apps/web/src/app/layout.tsx
import { MediaPlayerModal } from "~/components/media-player";
// ...
<MediaPlayerModal />;
```

`media-player-modal.tsx` statically imports video, controls, overlays, play-queue,
timeline, autoplay, and Watch Together rotation hooks. Browse/home users pay that
JS cost before they ever hit Play.

## Current state

- `apps/web/src/app/layout.tsx` — always mounts modal
- `apps/web/src/components/media-player/media-player-modal.tsx` — large client module (~900 lines) importing `MediaPlayerVideo` etc.
- Player open state is owned by Effect `PlayerService` / `playerCommands` (see `AGENTS.md`) — do not reintroduce Zustand/Jotai for player runtime.

## Commands you will need

| Purpose   | Command             | Expected on success |
| --------- | ------------------- | ------------------- |
| Typecheck | `bun run typecheck` | exit 0              |
| Lint      | `bun run lint`      | exit 0              |
| Tests     | `bun run test`      | exit 0              |

## Scope

**In scope**:

- `apps/web/src/app/layout.tsx`
- A thin client wrapper under `apps/web/src/components/media-player/` (e.g.
  `media-player-modal-lazy.tsx`) that `next/dynamic` or `React.lazy` loads the
  modal when playback is requested / player state becomes active
- Minimal glue to subscribe to player open state without importing the video stack

**Out of scope**:

- Extracting `packages/media-player` (parked in plans README)
- Changing playback / Syncplay semantics
- Font or theme provider changes in root layout

## Git workflow

- Commit: `perf(media-player): lazy-load modal from root layout`
- Do NOT open a PR unless instructed.

## Steps

### Step 1: Add a lazy boundary component

Create a client component that:

1. Subscribes only to “is player open / has current item” (via existing
   `usePlayerStateSelector` or equivalent lightweight selector).
2. Dynamically imports `MediaPlayerModal` when needed (and optionally preloads
   on intentional hover of Play controls if cheap).
3. Renders `null` when idle.

Avoid importing `./media-player-video` from the boundary module.

**Verify**: the root layout imports the boundary, not `MediaPlayerModal` directly:
`rg -n "MediaPlayerModal" apps/web/src/app/layout.tsx` → should not match the heavy module path.

### Step 2: Wire root layout

Replace eager `<MediaPlayerModal />` with the lazy boundary. Keep
`EffectRegistryProvider` above it so player atoms exist before load.

**Verify**: `bun run typecheck` → exit 0

### Step 3: Smoke the open path

Reason through / unit-test if feasible:

- Clicking Play on Continue Watching still opens the modal
- Soft-navigating while playing does not tear down the registry
- First open may show a brief load; that is acceptable vs shipping the chunk always

**Verify**: `bun run lint` → exit 0; run any existing media-player unit tests:
`bun test apps/web/src/components/media-player` (or nearest existing suite) → pass

## Test plan

- Prefer extending an existing player/session test if one mounts the modal.
- No Playwright requirement for this plan.

## Done criteria

- [ ] Root layout does not statically import the full modal/video graph
- [ ] Idle browse pages do not need the player chunk to hydrate the shell
- [ ] Play still works after lazy load
- [ ] README status DONE

## STOP conditions

- If Effect player state cannot be read without importing the video module,
  STOP and report the import cycle — do not duplicate player open state into
  Zustand.
- If Watch Together guest playback requires the modal on first paint of a
  specific route, limit eager load to that route layout only.

## Maintenance

Keep the media-player barrel (`index.ts`) from becoming the root-layout import
path for heavy modules; prefer direct file imports for the lazy boundary.
