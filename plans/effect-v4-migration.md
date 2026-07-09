# Effect v4 Migration Plan: Watch Together Session Architecture

Status: draft for review. No code moves until this is approved.

## Why

The Watch Together session lifecycle is currently modeled as **inference over
state diffs across two Zustand stores**: `useSyncplaySession` decides the
session ended by noticing `currentItem` no longer matches
`session.room.sourceUri`, and the auto-advance rotation is a hand-rolled state
machine (`armedKey` / `nextRoom` / `graceElapsed` / `swapped`) whose transition
rules are spread across five `useEffect`s in
`use-watch-together-auto-advance.ts`. Every bug found in PR #57's review cycle
was an instance of the same class:

- the swap depends on two store updates being observed atomically (currently
  guaranteed only by React batching plus a comment);
- "leave session" and "session rotating" are the same observable mismatch,
  disambiguated by timing;
- timers, retries, and reconnects live in effects whose re-run conditions are
  their dependency arrays, not explicit transition rules.

The fix is structural: **one owner for session state, transitions as commands,
intermediate states unrepresentable.** We adopt the architecture proven in
`UsefulSoftwareCo/executor` (Effect v4 + `@effect/atom-react`): tagged-union
domain state, pure policy functions, Effect fibers/`Deferred`/`Schedule` for
orchestration, and atoms as the React bridge. Executor also supplies the
tooling spine (lint enforcement, vitest setup, agent skills) so the discipline
is enforced rather than documented.

Executor precedents referenced throughout (clone: `UsefulSoftwareCo/executor`):

| Pattern | Executor path |
| --- | --- |
| Lifecycle as tagged union + fibers + `Deferred` + `Queue` | `packages/core/execution/src/engine.ts` |
| Pure decision function over counters/timers | `packages/hosts/cloudflare/src/mcp/session-alarm-policy.ts` |
| Atom client + query/mutation atoms + reactivity keys | `packages/react/src/api/{client,atoms,reactivity-keys}.tsx` |
| Boundary-wrapped non-Effect transport | `packages/plugins/mcp/src/sdk/connection.ts` |
| Escape-hatch lint enforcement | `scripts/oxlint-plugin-executor` |
| Agent skills for atom/schema/error discipline | `.agents/skills/wrdn-effect-*` |

## Current state inventory

| Concern | Today | Fate |
| --- | --- | --- |
| Server cache (rooms, metadata, queues) | tRPC + TanStack Query | **Keep** (phase 5 may revisit) |
| Syncplay wire protocol | `SyncplayClient` (framework-free class in `plex-query`) | **Keep** as boundary, wrapped in a scoped Effect resource |
| Driver arbitration | `SyncplaySessionController` | **Keep initially**, absorbed into the session service in phase 2 |
| Session lifecycle | `watch-together-store` + `use-syncplay-session` (clear-on-mismatch inference) | **Replace** with session service |
| Lobby presence + auto-start | `use-watch-together-lobby-presence` + effects in `watch-together-lobby.tsx` | **Replace** (phase 4) |
| Auto-advance rotation | `use-watch-together-auto-advance.ts` (5 effects) | **Replace** (phase 3); its pure helpers port unchanged |
| Rotation policy (election, room matching, joined checks) | `watch-together-auto-advance.ts` (pure, unit-tested) | **Port as-is** into the domain layer |
| Player mechanics (video element, transcode reload seeks, markers) | `media-player-store` + hooks | **Keep**; commanded through an explicit adapter |
| UI prefs (volume, captions, autoplay toggle) | `media-player-store` (persisted slice) | **Keep** |
| progress-store, last-library-store | Zustand | **Out of scope** |

## Target architecture

Three layers, mirroring executor's separation:

```text
┌────────────────────────────────────────────────────────────────┐
│ React (@effect/atom-react)                                     │
│   sessionStateAtom (stream-backed) · command atoms (fn atoms)  │
└──────────────────────────┬─────────────────────────────────────┘
                           │ SubscriptionRef.changes / commands
┌──────────────────────────▼─────────────────────────────────────┐
│ WatchTogetherSession service (Effect, client-side runtime)     │
│   owns SubscriptionRef<SessionState> · scoped socket fibers ·  │
│   rotation fiber (Schedule/Deferred/race) · player adapter     │
└──────────────────────────┬─────────────────────────────────────┘
                           │ pure calls
┌──────────────────────────▼─────────────────────────────────────┐
│ Domain (pure): SessionState union · rotation policy functions  │
└────────────────────────────────────────────────────────────────┘
```

### Layer 1: Domain model (`packages/plex-query` or new `packages/watch-together-domain`)

Pure, Schema-typed, no IO. The session state is a tagged union; rotation is a
nested union inside `Playing` (rotation happens *while* playing — it is not a
sibling state):

```ts
import { Schema } from "effect";

export type RotationPhase =
  | { readonly _tag: "None" }
  | { readonly _tag: "Armed" }                                  // in lead window, no room yet
  | { readonly _tag: "RoomKnown"; readonly nextRoom: WatchTogetherRoom }
  | {
      readonly _tag: "Gathering";                               // episode ended, observing next room
      readonly nextRoom: WatchTogetherRoom;
      readonly gatheredDeviceIds: ReadonlySet<string>;
    };

export type SessionState =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Lobby";
      readonly room: WatchTogetherRoom;
      readonly participants: ParticipantMap;
      readonly roomPosition: Option.Option<number>;
    }
  | {
      readonly _tag: "Playing";
      readonly room: WatchTogetherRoom;
      readonly item: PlayingItem;                                // ratingKey, serverId, ...
      readonly participants: ParticipantMap;
      readonly rotation: RotationPhase;
    };
```

Key property: **there is no representable state where the session's room and
the playing item disagree.** The swap is a single transition
`Playing(room A, item N, Gathering) → Playing(room B, item N+1, None)`; the
clear-on-mismatch inference and its batching invariant are deleted, not
defended.

The rotation *rules* become one pure decision function in the style of
executor's `decideSessionAlarm` — this centralizes what is currently smeared
across five effects, and it is exhaustively unit-testable with a fake clock:

```ts
export type RotationDecision =
  | { readonly kind: "wait" }
  | { readonly kind: "arm" }
  | { readonly kind: "create_room"; readonly afterMs: number }   // rank-staggered
  | { readonly kind: "adopt_room"; readonly room: WatchTogetherRoom }
  | { readonly kind: "begin_gathering" }
  | { readonly kind: "swap" };                                   // everyone joined or grace elapsed

export const decideRotation = (input: {
  readonly phase: RotationPhase;
  readonly timeRemainingSeconds: number;
  readonly rank: number;                                         // getAutoAdvanceRank (ported)
  readonly visibleRooms: ReadonlyArray<WatchTogetherRoom>;       // findNextEpisodeRoom input (ported)
  readonly everyoneJoined: boolean;                              // haveMultiplexParticipantsJoined (ported)
  readonly graceElapsed: boolean;
  readonly autoPlayEnabled: boolean;
}): RotationDecision => { /* pure */ };
```

`getAutoAdvanceRank`, `findNextEpisodeRoom`,
`haveMultiplexParticipantsJoined`, and `mergeParticipantState` port unchanged
from `apps/web/src/components/watch-together/watch-together-auto-advance.ts`,
along with their tests.

### Layer 2: `WatchTogetherSession` service (Effect, runs in the browser)

One service owns the `SubscriptionRef<SessionState>` and every socket, timer,
and API call. Transitions happen only inside the service — commands in, state
stream out.

```ts
export class WatchTogetherSession extends Effect.Service<WatchTogetherSession>()(
  "WatchTogetherSession",
  {
    scoped: Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<SessionState>({ _tag: "Idle" });
      // ...
      return {
        state,                                                    // SubscriptionRef<SessionState>
        joinLobby: (room: WatchTogetherRoom, user: SyncplayUser) => ...,
        startPlayback: (opts: { startPositionSeconds?: number }) => ...,
        playerEvent: (event: PlayerEvent) => ...,                 // play/pause/seek/time/ended/canplay
        leave: () => ...,                                         // deliberate close
      };
    }),
    dependencies: [WatchTogetherApi.Default, PlayerPort.Default],
  },
) {}
```

Orchestration mapping (all executor-proven primitives):

| Behavior | Today | Target |
| --- | --- | --- |
| Syncplay driver/observer socket | `SyncplayClient` + manual reconnect timers in 3 places | `Effect.acquireRelease` around `SyncplayClient`, reconnect via `Effect.retry(Schedule.exponential)` in a scoped fiber; fiber is interrupted automatically on state exit |
| Discovery polling | React Query `refetchInterval: 4000` gated on `armed` | `Effect.repeat(Schedule.spaced("4 seconds"))` fiber, started/stopped by rotation phase |
| Creation stagger | `setTimeout(CREATE_BASE_DELAY_MS + rank * CREATE_STAGGER_MS)` in an effect | `Effect.sleep(delay)` raced against room discovery (`Effect.raceFirst` — see executor's engine.ts note on `race` vs `raceFirst` in v4) |
| "Everyone joined, or grace" | observer connection + `graceElapsed` state + swap effect | `Deferred.await(everyoneJoined)` raced with `Effect.sleep(grace)` — executor's pause/approval shape |
| Create retry after failure | `createRetryToken` state bump to force effect re-run | `Effect.retry` on the create effect; the workaround class disappears |
| Idempotent transitions | `swapped` boolean + refs | transitions are `SubscriptionRef.update` with tag checks; commands on wrong states are no-ops by construction |

**Plex API access** stays on tRPC (the Plex token lives server-side): a small
`WatchTogetherApi` Effect service wraps the vanilla tRPC client
(`createTRPCClient` from `@trpc/client`, same router types) with typed errors.
This is executor's boundary pattern (`connection.ts` wrapping the MCP SDK).

**Player integration** stays imperative behind an explicit port:

```ts
export interface PlayerPort {
  readonly load: (item: MediaPlayerItem, opts: { startPositionSeconds?: number }) => void;
  readonly play: () => void;
  readonly pause: () => void;
  readonly seek: (seconds: number) => void;
  readonly snapshot: () => PlayerSnapshot;                        // time/duration/canPlay/...
}
```

The web app implements `PlayerPort` over the existing `media-player-store`
actions. The service *commands* the player and *receives* `playerEvent`s; it
never spies on the store. The existing `SyncplaySessionController` arbitration
logic (seek thresholds, startup grace, echo suppression) is absorbed into the
service's socket fiber in phase 2, keeping its unit tests.

### Layer 3: React bridge (`@effect/atom-react`)

```ts
// apps/web/src/watch-together/atoms.ts
const sessionRuntime = Atom.runtime(WatchTogetherSession.Default);

export const sessionStateAtom = sessionRuntime.atom(
  Effect.gen(function* () {
    const session = yield* WatchTogetherSession;
    return session.state.changes;                                 // Stream<SessionState>
  }).pipe(Effect.map(Stream.unwrap)),                             // stream-backed atom
);

export const joinLobbyAtom = sessionRuntime.fn((input: JoinLobbyInput) =>
  Effect.flatMap(WatchTogetherSession, (s) => s.joinLobby(input.room, input.user)),
);
```

Components read one atom (`useAtomValue(sessionStateAtom)`) and issue commands
(`useAtomSet(joinLobbyAtom)`). `RegistryProvider` mounts in the root layout
next to the existing tRPC provider. The exact stream-atom incantation is the
one pattern without an executor precedent; `.reference/effect-atom` (pull via
executor's `scripts/pull-references.ts` pattern, which we replicate here) has
the tests to copy from — validate it in the phase-2 spike before committing to
the shape above.

## Tooling spine (phase 0, before any behavior change)

- Dependencies via workspace catalog (already used for react/zod/etc.):
  `effect@4.0.0-beta.x` (pin the exact beta executor pins, currently
  `4.0.0-beta.59`), `@effect/atom-react`, `@effect/vitest`, `vitest`.
- **Test runner switch for Effect code**: `@effect/vitest` (with `TestClock`)
  for domain + service tests. Existing `bun:test` suites keep running until
  their subjects are ported; new Effect code is vitest-only. Root `test`
  script runs both during the transition.
- Port executor's `no-effect-escape-hatch` oxlint rule (multiplex already runs
  oxlint) so `Effect.runPromise`/`runSync` stay at boundaries.
- Optional but recommended: `effect-language-service` patch in `prepare`
  (executor does both this and `effect-tsgo`; adopt LSP first, evaluate tsgo
  separately since it changes typechecking).
- Port the relevant executor skills into `.agents/skills/`:
  `wrdn-effect-typed-errors`, `wrdn-effect-schema-boundaries`,
  `wrdn-effect-vitest-tests`, `wrdn-effect-atom-optimistic` (the atom skills
  matter from phase 2 on). Add a `scripts/pull-references.ts` and `.reference/`
  (gitignored) with `effect`, `effect-atom` for pattern lookup.

## Phasing

Each phase is independently shippable and gated on the full check suite plus
the two-account Playwright e2e (`watch-together.spec.ts` +
`watch-together-auto-advance.spec.ts`) staying green. The e2e suite is the
behavioral contract; it does not change during the migration.

- **Phase 0 — tooling.** Deps, catalog pins, vitest wiring, lint rule, skills,
  `.reference`. No behavior change. Verify: `bun run check`, both test
  runners, e2e smoke.
- **Phase 1 — domain layer.** `SessionState` union, `decideRotation`, ported
  pure helpers, `@effect/vitest` tests with `TestClock` covering the rotation
  timing rules that today only the e2e exercises (stagger, grace, failover,
  duplicate convergence, opt-out viewer). Pure code only; nothing imports it
  yet. Verify: unit tests.
- **Phase 2 — session service for playback (the spike).** `WatchTogetherSession`
  owning the driver socket lifecycle + `PlayerPort` + the atom bridge. Replaces
  `watch-together-store` + `use-syncplay-session` + the session-binding module
  for the *playing* path only (lobby and rotation still on the old code,
  temporarily commanding the service). This is deliberately the smallest cut
  that proves the stream-atom bridge and the socket-as-scoped-fiber pattern.
  Verify: e2e pause/resume + seek specs; `SyncplaySessionController` tests
  ported.
- **Phase 3 — rotation.** Fold auto-advance into the service as the
  `RotationPhase` machine driven by `decideRotation`; delete
  `use-watch-together-auto-advance.ts` (the hook; the pure module already moved
  in phase 1). Verify: auto-advance e2e; TestClock unit tests for every
  decision branch.
- **Phase 4 — lobby.** `Lobby` state absorbs presence + auto-start +
  late-join position; delete `use-watch-together-lobby-presence` and the
  lobby's effect logic (the component becomes a renderer of
  `sessionStateAtom` + command buttons). Verify: full e2e suite.
- **Phase 5 (separate decision, not scheduled).** Candidates, each with its
  own cost/benefit review: migrate `media-player-store` internals; replace the
  tRPC plex router with Effect `HttpApi` + `AtomHttpApi` (would bring
  executor-style reactivity keys to the browse surfaces); TanStack Query
  retirement. None are needed for the session architecture to pay off.

Ordering rationale: playback (phase 2) before rotation (phase 3) because
rotation composes on top of a working session service; lobby last because it
is the least buggy today and touches the most UI.

## Risks and mitigations

- **Effect v4 is beta; breaking changes between betas are expected.** Pin the
  exact version, upgrade deliberately (executor absorbs this routinely; we
  accept the same). v4 will be LTS at stabilization.
- **Stream-atom bridge has no executor precedent.** De-risked by making it the
  phase-2 spike with `.reference/effect-atom` as the pattern source; if the
  bridge fights us, the fallback (atom polling a `SubscriptionRef.get`, or a
  thin `useSyncExternalStore` adapter over the ref) keeps the service
  architecture intact — the bridge choice is swappable.
- **Next.js / RSC boundaries.** The service and atoms are client-only
  (`"use client"`), matching how the player and stores already work; the
  `RegistryProvider` mounts in the root layout. SSR never sees session state.
- **Bundle size.** v4 core is ~6–15 kB min+gz tree-shaken; acceptable.
- **Two paradigms during transition.** Contained by the port/adapter seams:
  Zustand survives only behind `PlayerPort` and UI prefs; no component reads
  both worlds for the same data at any phase boundary.
- **Solo-maintainer bus factor on Effect fluency.** Mitigated by the skills +
  lint rules + `.reference` repos, which is exactly how executor keeps agents
  productive in this stack.

## Open questions for review

1. Domain layer location: new `packages/watch-together-domain`, or inside
   `packages/plex-query` (which already holds the pure helpers and the
   Syncplay protocol types)? Default: keep in `plex-query` to avoid a package
   split before the shape settles.
2. Pin `effect-tsgo` from day one (executor does) or stay on `tsc` until
   phase 2 proves out? Default: stay on `tsc`.
3. Should phase 2 also absorb `SyncplaySessionController` or wrap it as-is
   first? Default: wrap as-is, absorb in a follow-up inside phase 2 once e2e
   is green on the wrapped version.
