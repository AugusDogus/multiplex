# Plan 007: Stream library page — stop serial pivots/meta/content awaits

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 38dbd82..HEAD -- apps/web/src/app/(app)/media/[machineIdentifier]/[providerIdentifier]/page.tsx apps/web/src/app/(app)/media/[machineIdentifier]/[providerIdentifier]/loading.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (pivot tab correctness + URL searchParam handling)
- **Depends on**: plans/006-unblock-app-plex-content-gate.md (strongly recommended first so `loading.tsx` is visible)
- **Category**: perf
- **Planned at**: commit `38dbd82`, 2026-07-19

## Why this matters

Opening a library pays a serial PMS chain before posters paint:

1. `getAppPlexContext()` (layout/page)
2. `getLibraryPivots` **outside** the pivot `Suspense` (blocks header + tabs)
3. Inside library tab: `getLibraryMeta` **then** `getLibraryContent`

That is multiple round-trips stacked on every library navigation. Home already
uses independent Suspense lanes; library should match.

## Current state

`apps/web/src/app/(app)/media/[machineIdentifier]/[providerIdentifier]/page.tsx`:

```tsx
const { servers, userInfo } = await getAppPlexContext();
// ...
const { title: librarySectionTitle, pivots } = await api.plex.getLibraryPivots({
  machineIdentifier,
  sectionId: source,
});
// ... then return with Suspense around LibraryPivotContent
```

```tsx
async function renderLibraryTab(...) {
  const meta = await api.plex.getLibraryMeta({ ... });
  const { type, typeNumber } = resolveActiveType(meta, requestedType);
  const sort = resolveSort(type, requestedSort);
  const libraryContent = await api.plex.getLibraryContent({ ... });
}
```

Pivot tabs for collections/playlists/categories each await a single query —
acceptable once pivots themselves are streamed. Recommended pivot already
prefetches hubs correctly.

## Commands you will need

| Purpose   | Command             | Expected on success |
| --------- | ------------------- | ------------------- |
| Typecheck | `bun run typecheck` | exit 0              |
| Lint      | `bun run lint`      | exit 0              |
| Tests     | `bun run test`      | exit 0              |

## Scope

**In scope**:

- `apps/web/src/app/(app)/media/[machineIdentifier]/[providerIdentifier]/page.tsx`
- Skeleton components already used by this route (`LibraryPivotSkeleton`,
  header skeletons) — only if needed to stream tabs
- Existing library query helpers under `apps/web/src/server/queries/` only if
  a combined meta+content procedure is clearly better than parallel calls
  (prefer parallel `Promise.all` first)

**Out of scope**:

- Rewriting `MediaPosterGrid` virtualization
- Changing `LIBRARY_PAGE_SIZE`
- Live TV / hubs / playlists routes (separate plans)

## Git workflow

- Conventional Commits: `perf(library): stream pivots and parallelize meta/content`
- Do NOT open a PR unless instructed.

## Steps

### Step 1: Move `getLibraryPivots` behind Suspense

Structure the page like home:

- Resolve `params` / `searchParams` / server existence check first (cheap).
- Render `AppPageLayout` shell with a Suspense'd header title + tabs that await
  pivots.
- Keep pivot content in its existing `Suspense key={activePivot}` lane.

Active pivot resolution currently needs the pivots list. Options (pick one):

A. Default `activePivot` from the URL with `isSupportedPivot` before pivots
return; reconcile inside the tabs Suspense if the server lacks that pivot.
B. Suspense a combined “tabs + content” block keyed by URL, but still stream
past `getAppPlexContext` where possible.

Do **not** leave `await getLibraryPivots` on the critical path before any
Suspense boundary that can show `loading.tsx` / `LibraryPivotSkeleton`.

**Verify**: `rg -n "getLibraryPivots" apps/web/src/app/\(app\)/media -A3 -B3` — call site is inside an async child wrapped by `<Suspense>`, not in the page body before the first Suspense that paints UI.

### Step 2: Parallelize library tab meta + first page where possible

`resolveActiveType` needs meta before `typeNumber` is known for content. Options:

1. If URL already has a valid `type` searchParam, start `getLibraryContent` in
   parallel with `getLibraryMeta` using that type number, and reconcile if meta
   rejects it.
2. Otherwise keep meta→content serial but ensure this runs only inside the
   pivot Suspense (so header/tabs can paint).

Prefer (1) when `requestedType` is present.

**Verify**: `bun run typecheck` → exit 0

### Step 3: Keep HydrateClient only where client queries need it

Recommended tab already uses `prefetch` + `HydrateClient`. Do not regress to
blocking `await api.plex.getLibraryHubs(...)` without Suspense.

**Verify**: `bun run lint` → exit 0

## Test plan

- Extend or add a focused test only if there is an existing page/query test
  harness; otherwise manual checklist:
  - `/media/...` with `?source=` shows skeleton then recommended hubs
  - Switching `pivot=library` shows controls + posters
  - Invalid pivot falls back to recommended

## Done criteria

- [ ] Library pivots fetch is not an un-Suspense'd await before shell paint
- [ ] Library tab avoids avoidable serial meta→content when type is in the URL
- [ ] `bun run typecheck` + `bun run lint` pass
- [ ] README status DONE

## STOP conditions

- If pivot IDs from PMS are required to validate the URL before any UI can
  render (product requirement), document that and only Suspense the content
  lane — still remove any await that is not strictly required for the shell.
- Do not add `"use cache"` on library content without an invalidation story for
  sort/filter changes.

## Maintenance

Library browse params live in `apps/web/src/lib/library-browse-params.ts` —
keep URL ↔ query key identity stable (`buildLibraryContentKey`).
