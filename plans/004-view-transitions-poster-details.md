# Plan 004: Spike — View Transitions on poster → item details

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 43e847c..HEAD -- apps/web/next.config.js apps/web/src/hooks/use-item-details-navigation.ts apps/web/src/components/media-poster-card.tsx apps/web/src/components/media-item-details apps/web/src/lib/plex-image.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (name collisions, scroll restoration, reduced-motion)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `43e847c`, 2026-07-16 (refreshed; still no View Transitions API usage)

## Why this matters

Poster → details is the core browse funnel into Watch Together invite. There is
**no** View Transitions usage today (`startViewTransition` / Next
`viewTransitions` absent). Prefetch already exists
(`useItemDetailsNavigation`); shared-element continuity is the missing polish.
Sidebar/tab active states already have `data-active` / `aria-current` chrome —
**do not** expand this spike into sidebar/tab transitions unless poster→details
is done and stable.

## Current state

- Navigation: `apps/web/src/hooks/use-item-details-navigation.ts` — `prefetch` +
  `router.push(getItemDetailsHref(...))`
- Poster card links: `apps/web/src/components/media-poster-card.tsx` (hover scale
  only; no `view-transition-name`)
- Details hero poster: `apps/web/src/components/media-item-details/details-hero.tsx`
  uses `next/image` with URLs from `getPlexImagePath` (`~/lib/plex-image`) —
  shared-element transition must target that poster `Image` (and the matching
  poster on the card), not a removed raw PMS URL path
- `apps/web/next.config.js`: Next 16 preview config with `cacheComponents`,
  `partialPrefetching`, `images: { unoptimized: true }` — **no** viewTransitions
  flag yet
- App uses App Router under `apps/web/src/app/(app)/…` and item routes via
  `getItemDetailsHref` in `apps/web/src/lib/plex-routes.ts`

**Next 16 note**: `apps/web/AGENTS.md` says this is not the Next.js you know —
read `node_modules/next/dist/docs/` for the current View Transitions /
`viewTransition` API before coding. Prefer the framework-supported approach
over hand-rolled `document.startViewTransition` if Next documents one for this
version.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `bun install` | exit 0 |
| Dev | `bun dev` | :3000 |
| Check | `bun run check` | exit 0 |
| Docs | Read Next docs under `apps/web/node_modules/next/dist/docs/` for view transitions | — |

## Scope

**In scope**:
- Enabling View Transitions the Next-16-correct way (`next.config` and/or
  CSS / Link props — whatever current docs prescribe)
- Shared transition name on poster image → details hero image, keyed by
  `ratingKey` (and serverId if needed for uniqueness)
- `prefers-reduced-motion: reduce` must disable or shorten the transition
- Short findings note: `plans/004-view-transitions-findings.md` (browser
  support notes + decisions)
- `plans/README.md` status for 004

**Out of scope**:
- Sidebar active-state transitions
- Library tabs transitions
- Player modal open/close transitions
- Rewriting routing structure
- Animating every list on the home page

## Git workflow

- Commits: `feat(web): add poster to details view transitions` and/or
  `docs(plans): view transitions spike notes`

## Steps

### Step 1: Read Next 16 View Transitions docs

From `apps/web`, locate the official guidance in `node_modules/next/dist/docs/`
(search for view transition). Record the exact enablement API in
`plans/004-view-transitions-findings.md`.

**Verify**: findings file cites the doc path / option name you will use.

### Step 2: Enable framework support

Apply the documented config/flag. Keep the change minimal.

**Verify**: `bun run --filter @multiplex/web typecheck` → exit 0; app still
boots with `bun dev`.

### Step 3: Shared element on one path

Pick **one** poster entry point (home hub or library grid `MediaPosterCard`)
and the details hero `<img>` / `Image`:

1. Set matching `view-transition-name` (CSS) or the React/Next prop equivalent
   derived from `ratingKey` (sanitize to a valid name: e.g.
   `poster-${ratingKey}`).
2. Ensure only **one** element with that name exists in the old and new states
   (grids with many posters: only the clicked/navigating poster should carry
   the name, or clear names on siblings — document the chosen strategy).
3. Keep existing prefetch behavior.

**Verify**: In Chromium, clicking a poster morphs into the details poster
(or cross-fades if shared element unsupported). In Firefox/Safari, navigation
still works with graceful degradation (no hard error).

### Step 4: Reduced motion

Add CSS so `@media (prefers-reduced-motion: reduce)` disables the custom
transition (instant navigate / default).

**Verify**: with OS reduced-motion on, no long morph animation.

### Step 5: Checks + index

**Verify**: `bun run check` → exit 0; update 004 to DONE in `plans/README.md`.

## Test plan

- Manual Chromium + one other browser.
- No mandatory e2e unless you can assert without flake; prefer manual note in
  findings.
- If adding a tiny name-helper pure function, unit-test it with `bun test`.

## Done criteria

- [ ] Findings doc records the Next 16 enablement API used
- [ ] At least one poster → `/item/...` path uses a shared view transition
- [ ] Reduced motion respected
- [ ] Sidebar/tabs **unchanged** by this plan
- [ ] `bun run check` exits 0
- [ ] `plans/README.md` 004 DONE

## STOP conditions

- Next 16 docs say View Transitions are unsupported / experimental in a way
  that breaks `cacheComponents` — stop and report rather than hacking
  `document.startViewTransition` around the router
- Fixing name collisions requires rewriting the virtualized grid architecture
- Scope creep into sidebar/tab animations

## Maintenance notes

- Follow-up plans can add library-tabs / sidebar once the naming scheme is
  proven.
- Reviewers: watch for duplicate `view-transition-name` in lists (broken
  animations / console warnings).
