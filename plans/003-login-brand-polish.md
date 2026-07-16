# Plan 003: Polish `/login` to match in-app Multiplex brand

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 43e847c..HEAD -- apps/web/src/app/login apps/web/src/components/login-form.tsx apps/web/src/components/multiplex-logo.tsx apps/web/src/app/layout.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S–M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `43e847c`, 2026-07-16 (refreshed; login still scaffold — `Command` + `href="#"` + flat `bg-background`)

## Why this matters

Unauthenticated users always hit `/login` (proxy redirect). The page is a
scaffold: flat `bg-background`, Lucide `Command` icon, dead `href="#"`, and a
generic checkmark SVG on “Continue with Plex.” In-app chrome already has
`MultiplexLogo`. Watch Together e2e and every real session start here — the
first impression should match the product, not create-t3-app defaults.

Auth flow (Better Auth + Plex PIN OAuth) must **not** change — visual/brand
only.

## Current state

`apps/web/src/app/login/page.tsx`:

```tsx
<div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
  <div className="w-full max-w-sm">
    <LoginForm />
  </div>
</div>
```

`apps/web/src/components/login-form.tsx` (brand block):

```tsx
<a href="#" className="flex flex-col items-center gap-2 font-medium">
  <div className="flex size-8 items-center justify-center rounded-md">
    <Command className="size-6 dark:text-white" />
  </div>
  <span className="sr-only">Multiplex</span>
</a>
<h1 className="text-xl font-bold">Welcome to Multiplex</h1>
```

Real mark: `apps/web/src/components/multiplex-logo.tsx` (`MultiplexLogo`).

Root fonts: Geist only in `apps/web/src/app/layout.tsx` — do **not** introduce
a second display font stack unless the rest of the app already moved; match
existing tokens (`bg-background`, `text-muted-foreground`, shadcn `Button`).

Inspiration named by maintainer (Intern3Chat / Overseerr) is **visual
reference only** — do not copy their code or add their deps.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Dev | `bun dev` | :3000 |
| Check | `bun run check` | exit 0 |
| Lint web | `bun run --filter @multiplex/web lint` | exit 0 |

## Suggested executor toolkit

- If available, read `/workspace/.agents/skills/emil-design-eng/SKILL.md` before
  polishing motion/spacing.
- Respect user frontend rules already in the repo agent context: brand-first
  hero, avoid purple-glow AI aesthetic, avoid card-for-card's-sake, atmosphere
  via gradient/pattern (not flat void), keep one composition on first viewport.

## Scope

**In scope**:
- `apps/web/src/app/login/page.tsx`
- `apps/web/src/components/login-form.tsx`
- Optional tiny shared CSS under `apps/web/src/styles/` **only if** login needs
  a background utility not expressible in Tailwind utilities already used
- `plans/README.md` status for 003

**Out of scope**:
- Changing `authClient.plex.signIn()` / Better Auth / Plex OAuth
- Redesigning the authenticated shell / sidebar (sidebar still uses `Command`
  in places — fixing that is optional follow-up, not required)
- Adding Overseerr or other IdPs
- New font families that fight Geist app-wide
- Marketing landing page separate from `/login`

## Git workflow

- Commit: `feat(web): polish login brand and layout` (or `fix` if treating as UX bug)

## Steps

### Step 1: Align brand mark and copy

In `login-form.tsx`:

1. Replace Lucide `Command` with `MultiplexLogo` (same sizing as in-app usage
   where possible).
2. Remove the dead `href="#"` wrapper — use a `<div>` or `<span>` for the mark;
   visible “Multiplex” text should not be sr-only only if the logo is purely
   iconic (prefer visible product name as hero signal).
3. Replace the checkmark-in-circle SVG on the button with a simple Plex-colored
   mark **or** no leading icon + clear “Continue with Plex” label. Do not use
   trademarked assets in a way that violates Plex branding guidelines; a
   neutral button with accurate copy is acceptable.
4. Keep Terms/Privacy links to plex.tv as they are.

**Verify**: `rg 'Command|href="#"' apps/web/src/components/login-form.tsx` →
no matches for those scaffold leftovers.

### Step 2: Compose the page atmosphere

In `login/page.tsx`, replace flat void with one composed full-viewport
background (subtle gradient or soft pattern using existing CSS variables /
Tailwind theme tokens). Keep a single column: brand, one short supporting
line, one CTA. No feature cards, no stats, no secondary marketing blocks.

Ensure light and dark mode both remain readable (`next-themes` is already
app-wide).

**Verify**: open `/login` logged-out — one clear composition; CTA still calls
`handlePlexLogin`.

### Step 3: Sanity + checks

**Verify**: `bun run check` → exit 0.

Manually: click Continue with Plex still opens/starts OAuth (do not commit
secrets). If e2e helpers look for specific login copy/selectors, update
`apps/web/e2e/helpers/plex-login.ts` **only if** selectors break — prefer
keeping the button role/name “Continue with Plex”.

### Step 4: Update plans index

003 → DONE in `plans/README.md`.

## Test plan

- No new unit tests required for presentational markup unless you extract a
  pure helper.
- If Playwright setup selectors change, run
  `bun run --filter @multiplex/web test:e2e:setup` only when Plex credentials
  exist; otherwise note manual OAuth smoke in the PR.

## Done criteria

- [ ] `/login` uses `MultiplexLogo` (or shared brand component), not Lucide `Command`
- [ ] No `href="#"` on the brand control
- [ ] Page has non-flat atmosphere; still one CTA (Plex sign-in)
- [ ] `authClient.plex.signIn` path unchanged
- [ ] `bun run check` exits 0
- [ ] `plans/README.md` 003 DONE

## STOP conditions

- Auth plugin or callback routes need changes for the visual pass
- Design expands into a multi-section marketing site
- You are about to add a second global font without migrating the app shell

## Maintenance notes

- Optional follow-up: replace sidebar `Command` with `MultiplexLogo` for
  consistency (`app-sidebar.tsx`).
- Reviewers: watch for overly generic “AI aesthetic” (purple glow, glass cards).
