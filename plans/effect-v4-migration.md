# Effect v4 Migration Plan: Watch Together Session Architecture

Status: phases 0-4 and the PlayerService split cover this PR. The broader
phase-5 server-data migration is deferred and explicitly out of scope.

## Why

Before this migration, the Watch Together session lifecycle was modeled as
**inference over state diffs across two Zustand stores**: `useSyncplaySession`
decided the session ended by noticing `currentItem` no longer matched
`session.room.sourceUri`, and the auto-advance rotation was a hand-rolled state
machine (`armedKey` / `nextRoom` / `graceElapsed` / `swapped`) whose transition
rules were spread across five `useEffect`s in
`use-watch-together-auto-advance.ts`. Every bug found in PR #57's review cycle
was an instance of the same class:

- the swap depended on two store updates being observed atomically (guaranteed
  only by React batching plus a comment);
- "leave session" and "session rotating" are the same observable mismatch,
  disambiguated by timing;
- timers, retries, and reconnects live in effects whose re-run conditions are
  their dependency arrays, not explicit transition rules.

The fix is structural: **one owner for session state, transitions as commands,
intermediate states unrepresentable.** We adopt the architecture proven in
`UsefulSoftwareCo/executor` (Effect v4 + `@effect/atom-react`): tagged-union
domain state, pure policy functions, Effect fibers/`Deferred`/`Schedule` for
orchestration, and atoms as the React bridge. Executor also supplies the
tooling spine (test discipline and focused agent skills) so the discipline is
part of the repository workflow rather than prose alone.

Executor precedents referenced throughout (clone: `UsefulSoftwareCo/executor`):

| Pattern                                                   | Executor path                                               |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| Lifecycle as tagged union + fibers + `Deferred` + `Queue` | `packages/core/execution/src/engine.ts`                     |
| Pure decision function over counters/timers               | `packages/hosts/cloudflare/src/mcp/session-alarm-policy.ts` |
| Atom client + query/mutation atoms + reactivity keys      | `packages/react/src/api/{client,atoms,reactivity-keys}.tsx` |
| Boundary-wrapped non-Effect transport                     | `packages/plugins/mcp/src/sdk/connection.ts`                |
| Agent skills for schema/error/test discipline             | `.agents/skills/wrdn-effect-*`                              |

## Pre-migration inventory

| Concern                                                  | Baseline                                                                      | Fate                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Server cache (rooms, metadata, queues)                   | tRPC + TanStack Query                                                         | **Keep** (phase 5 may revisit)                                    |
| Syncplay wire protocol                                   | `SyncplayClient` (framework-free class in `plex-query`)                       | **Keep** as boundary, wrapped in a scoped Effect resource         |
| Driver arbitration                                       | `SyncplaySessionController`                                                   | **Keep** behind the session service's scoped connection lifecycle |
| Session lifecycle                                        | `watch-together-store` + `use-syncplay-session` (clear-on-mismatch inference) | **Replace** with session service                                  |
| Lobby presence + auto-start                              | `use-watch-together-lobby-presence` + effects in `watch-together-lobby.tsx`   | **Replace** (phase 4)                                             |
| Auto-advance rotation                                    | `use-watch-together-auto-advance.ts` (5 effects)                              | **Replace** (phase 3); its pure helpers port unchanged            |
| Rotation policy (election, room matching, joined checks) | `watch-together-auto-advance.ts` (pure, unit-tested)                          | **Port as-is** into the domain layer                              |
| Player lifecycle and playback state                      | `media-player-store` + hooks                                                  | **Replace** with `PlayerService`; expose through Effect atoms     |
| Video element and transcode mechanics                    | React hooks                                                                   | **Keep** behind `PlayerPort` and identity-scoped commands         |
| UI prefs (volume, captions, autoplay toggle)             | `media-player-store` (persisted slice)                                        | **Split** into narrow `player-prefs-store` persistence adapter    |
| progress-store, last-library-store                       | Zustand                                                                       | **Out of scope**                                                  |

## Target architecture

Three layers, mirroring executor's separation:

```text
┌────────────────────────────────────────────────────────────────┐
│ React (@effect/atom-react)                                     │
│   sessionStateAtom (SubscriptionRef) · plain command facade    │
└──────────────────────────┬─────────────────────────────────────┘
                           │ SubscriptionRef.changes / commands
┌──────────────────────────▼─────────────────────────────────────┐
│ WatchTogetherSession service (Effect, client-side runtime)     │
│   owns SubscriptionRef<SessionState> · scoped socket fibers ·  │
│   rotation fiber (Schedule/Deferred/scoped children) ·         │
│   serialized lifecycle commands · player adapter               │
└──────────────────────────┬─────────────────────────────────────┘
                           │ pure calls
┌──────────────────────────▼─────────────────────────────────────┐
│ Domain (pure): SessionState union · rotation policy functions  │
└────────────────────────────────────────────────────────────────┘
```

### Layer 1: Domain model (`packages/plex-query`)

Pure TypeScript, no IO. The session state is a tagged union; rotation is a
nested union inside `Playing` (rotation happens _while_ playing — it is not a
sibling state):

```ts
export type RotationPhase =
  | { readonly _tag: "None" }
  | { readonly _tag: "Armed" } // in lead window, no room yet
  | { readonly _tag: "RoomKnown"; readonly nextRoom: WatchTogetherRoom }
  | {
      readonly _tag: "Gathering"; // episode ended, observing next room
      readonly nextRoom: WatchTogetherRoom;
      readonly gatheredDeviceIds: ReadonlySet<string>;
    };

export type SessionState =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Lobby";
      readonly room: WatchTogetherRoom;
      readonly participants: ParticipantMap;
      readonly roomPositionSeconds: number | null;
      readonly everyonePresentSticky: boolean;
    }
  | {
      readonly _tag: "Playing";
      readonly room: WatchTogetherRoom;
      readonly item: PlayingItem; // ratingKey, serverId, ...
      readonly participants: ParticipantMap;
      readonly rotation: RotationPhase;
    };
```

Key property: **there is no representable state where the session's room and
the playing item disagree.** The swap is a single transition
`Playing(room A, item N, Gathering) → Playing(room B, item N+1, None)`; the
clear-on-mismatch inference and its batching invariant are deleted, not
defended.

The rotation _rules_ became one pure decision function in the style of
executor's `decideSessionAlarm`, centralizing what was previously spread across
five effects and making it exhaustively unit-testable with a fake clock:

```ts
export type RotationDecision =
  | { readonly kind: "wait" }
  | { readonly kind: "arm" }
  | { readonly kind: "create_room"; readonly afterMs: number } // rank-staggered
  | { readonly kind: "adopt_room"; readonly room: WatchTogetherRoom }
  | { readonly kind: "begin_gathering" }
  | { readonly kind: "swap" } // everyone joined or grace elapsed
  | { readonly kind: "invalidate_room" }
  | { readonly kind: "disabled" };

export const decideRotation = (input: {
  readonly phase: RotationPhase;
  readonly timeRemainingSeconds: number;
  readonly durationSeconds: number;
  readonly currentTimeSeconds: number;
  readonly rank: number; // getAutoAdvanceRank (ported)
  readonly visibleRooms: ReadonlyArray<WatchTogetherRoom>; // findNextEpisodeRoom input (ported)
  readonly everyoneJoined: boolean; // haveMultiplexParticipantsJoined (ported)
  readonly graceElapsed: boolean;
  readonly autoPlayEnabled: boolean;
  readonly serverId: string;
  readonly nextRatingKey: string;
  readonly currentRoom: Pick<WatchTogetherRoom, "id" | "users">;
  readonly hasAttemptedCreate?: boolean;
}): RotationDecision => {
  /* pure */
};
```

`getAutoAdvanceRank`, `findNextEpisodeRoom`,
`haveMultiplexParticipantsJoined`, and `mergeParticipantState` now live in
`packages/plex-query/src/watch-together/rotation-policy.ts`, along with their
tests.

### Layer 2: `WatchTogetherSession` service (Effect, runs in the browser)

One service owns the `SubscriptionRef<SessionState>`, session sockets and
timers, and the transport calls needed for session orchestration. Cached browse,
details, lobby room, and RSC data remain on tRPC + TanStack Query. Lifecycle
transitions happen inside the service — commands in, state stream out.

```ts
export class WatchTogetherSession extends Context.Service<
  WatchTogetherSession,
  WatchTogetherSessionShape
>()("WatchTogetherSession") {
  static readonly Default = Layer.effect(WatchTogetherSession)(
    Effect.gen(function* () {
      const player = yield* PlayerPort;
      const api = yield* WatchTogetherApi;
      return yield* makeWatchTogetherSession({ player, api });
    }),
  );
}
```

Orchestration mapping (all executor-proven primitives):

| Behavior                        | Before migration                                                           | Shipped implementation                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Syncplay driver/observer socket | `SyncplayClient` + manual reconnect timers in 3 places                     | `Effect.acquireRelease` in a scoped `Effect.forever` loop with a fixed reconnect sleep; scope interruption disconnects the active client  |
| Discovery polling               | React Query `refetchInterval: 4000` gated on `armed`                       | Scoped `Effect.repeat(Schedule.spaced("4 seconds"))`, started and stopped by rotation decisions                                           |
| Creation stagger                | `setTimeout(CREATE_BASE_DELAY_MS + rank * CREATE_STAGGER_MS)` in an effect | Scoped `Effect.sleep(delay)` child fiber; a validated response is adopted immediately while discovery continues for duplicate convergence |
| "Everyone joined, or grace"     | observer connection + `graceElapsed` state + swap effect                   | Participant callbacks evaluate immediately while one scoped grace fiber sleeps, marks `graceElapsed`, and re-evaluates                    |
| Create retry after failure      | `createRetryToken` state bump to force effect re-run                       | Failure clears `hasAttemptedCreate` and re-evaluates, scheduling a fresh rank-staggered create attempt                                    |
| Lifecycle serialization         | Ordering depended on React effects and store updates                       | A one-permit `Semaphore` serializes enter, exit, start, swap, and leave; generation and identity guards reject stale detached work        |
| Idempotent transitions          | `swapped` boolean + refs                                                   | `SubscriptionRef.update` tag/identity checks and explicit fiber cancellation make stale or inapplicable work a no-op                      |

**Plex API access** stays on tRPC (the Plex token lives server-side): a small
`WatchTogetherApi` Effect service wraps the vanilla tRPC client
(`createTRPCClient` from `@trpc/client`, same router types, SuperJSON) with typed errors.
This is executor's boundary pattern (`connection.ts` wrapping the MCP SDK).

**Player integration** stays imperative behind an explicit port:

```ts
export interface PlayerPort {
  readonly load: (
    item: MediaPlayerItem,
    opts: { resume: boolean; startPositionSeconds?: number },
  ) => void;
  readonly play: () => boolean | Promise<boolean>;
  readonly pause: () => void;
  readonly seek: (seconds: number) => MediaPlayerSeekResult;
  readonly snapshot: () => PlayerSnapshot; // time/duration/canPlay/...
}
```

`PlayerService` is the canonical playback owner. React reads focused projections
through a selector-based `useSyncExternalStore` bridge over the service's change
stream; `PlayerPort` adapts the same service instance for Watch Together
commands. The video element remains an imperative React boundary and registers
generation-scoped play/pause/seek actions. A narrow Zustand `player-prefs-store`
persists preferences only and never mirrors playback state. The existing
`SyncplaySessionController` remains behind the service's scoped connection fiber
and keeps its arbitration unit tests.

### Layer 3: React bridge (`@effect/atom-react`)

```ts
const session = sessionRuntime.runSync(
  Effect.gen(function* () {
    return yield* WatchTogetherSession;
  }),
);

const stateAtom = Atom.subscriptionRef(session.state);

export const sessionStateAtom = stateAtom.pipe(Atom.keepAlive);

export const sessionCommands = {
  enterLobby(input: EnterLobbyInput) {
    return { completion: sessionRuntime.runPromise(session.enterLobby(input)) };
  },
};
```

Components read one atom (`useAtomValue(sessionStateAtom)`) and issue commands
through a plain runtime-backed facade. `RegistryProvider` mounts in the root
layout next to the existing tRPC provider. `Atom.subscriptionRef` is the session
state bridge; the player uses its selector-based `useSyncExternalStore` bridge.
Transport caching and mutations remain TanStack Query concerns.

## Tooling spine (phase 0, before any behavior change)

- Dependencies via workspace catalog (already used for react/zod/etc.):
  `effect@4.0.0-beta.x` (pin the exact beta executor pins, currently
  `4.0.0-beta.59`) and `@effect/atom-react`.
- **Test runner stays `bun test`** (owner preference: no vite/vitest in this
  repo). Effect suites run effects via `Effect.runPromise` (test files are a
  designated escape-hatch boundary) and get timer determinism from
  `TestClock` in `effect/testing` (`TestClock.layer()` + `TestClock.adjust`),
  which is runner-agnostic in v4. See `.agents/skills/effect-bun-tests`.
- Optional but recommended: `effect-language-service` patch in `prepare`
  (executor does both this and `effect-tsgo`; adopt LSP first, evaluate tsgo
  separately since it changes typechecking).
- Port the relevant executor skills into `.agents/skills/`:
  `wrdn-effect-typed-errors`, `wrdn-effect-schema-boundaries`,
  and `wrdn-effect-vitest-tests` (adapted to `bun:test` as
  `effect-bun-tests`).

## Phasing

Each phase is independently shippable and gated on the full check suite plus
the two-account Playwright e2e (`watch-together.spec.ts` +
`watch-together-auto-advance.spec.ts`) staying green. The e2e suite is the
behavioral contract; it does not change during the migration.

- **Phase 0 — tooling.** Dependencies, catalog pins, and focused skills. No
  behavior change. Verify: `bun run check`, both test runners, e2e smoke.
- **Phase 1 — domain layer.** `SessionState` union, `decideRotation`, ported
  pure helpers, `bun:test` suites with `TestClock` (from `effect/testing`) covering the rotation
  timing rules that previously only the e2e exercised (stagger, grace, failover,
  duplicate convergence, opt-out viewer). Pure code only; nothing imports it
  yet. Verify: unit tests.
- **Phase 2 — session service for playback (the spike).** `WatchTogetherSession`
  owning the controller/socket lifecycle + `PlayerPort` + the atom bridge. At
  this phase it replaced `watch-together-store` + `use-syncplay-session` + the
  session-binding module for the _playing_ path only, while lobby and rotation
  temporarily remained on the old code. This was the smallest cut that proved
  the `SubscriptionRef` atom bridge and socket-as-scoped-fiber pattern.
  Verify: e2e pause/resume + seek specs; `SyncplaySessionController` tests
  ported.
- **Phase 3 — rotation.** Fold auto-advance into the service as the
  `RotationPhase` machine driven by `decideRotation`; delete
  `use-watch-together-auto-advance.ts` (the hook; the pure module already moved
  in phase 1). Verify: auto-advance e2e; TestClock unit tests for every
  decision branch.
- **Phase 4 — lobby.** `Lobby` state absorbs presence + auto-start +
  late-join position; delete `use-watch-together-lobby-presence` and the
  lobby's effect logic (the component became a renderer of
  `sessionStateAtom` + command buttons). Verify: full e2e suite.
- **PlayerService split — complete.** Replace canonical Zustand playback state
  with `PlayerService`, a shared Effect runtime, selector-based React
  subscriptions, and generation-scoped `PlayerPort` actions. Preserve the
  legacy localStorage shape through a preference-only Zustand adapter.
- **Phase 5 server data — deferred; non-goal for this PR.** Do not replace the
  tRPC Plex router with Effect `HttpApi` / `AtomHttpApi`, introduce browse
  atoms, or retire TanStack Query. Effect v4 does not yet have a mature Next.js
  precedent for replacing this data stack, so doing so here would add
  framework-integration risk unrelated to the player/session migration. Retain
  tRPC + SuperJSON transport and TanStack Query caching/RSC hydration semantics.

Ordering rationale: playback (phase 2) before rotation (phase 3) because
rotation composes on top of a working session service; lobby last because it
was the least buggy area and touched the most UI.

## Risks and mitigations

- **Effect v4 is beta; breaking changes between betas are expected.** Pin the
  exact version, upgrade deliberately (executor absorbs this routinely; we
  accept the same). v4 will be LTS at stabilization.
- **The React bridge is intentionally narrow.** `Atom.subscriptionRef` exposes
  session state; commands run at the managed-runtime boundary. No server-data
  cache behavior is delegated to atoms in this PR.
- **Next.js / RSC boundaries.** The service and atoms are client-only
  (`"use client"`), matching how the player and stores already work; the
  `RegistryProvider` mounts in the root layout. SSR never sees session state.
- **Bundle size.** v4 core is ~6–15 kB min+gz tree-shaken; acceptable.
- **Multiple state tools.** Contained by ownership: Effect `PlayerService` and
  `WatchTogetherSession` own canonical player/session runtime state; tRPC +
  TanStack Query + SuperJSON own server data and RSC hydration; Zustand persists
  preferences and unrelated local UI state. Jotai is not used. The media-player
  modal reads both Effect services to enforce their item-identity boundary.
- **Solo-maintainer bus factor on Effect fluency.** Mitigated by focused skills,
  deterministic tests, and repository-local architecture guidance.
