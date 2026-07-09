---
name: effect-atom-optimistic
description: Detects hand-rolled optimistic-update plumbing in React code that should be using effect-atom's Atom.optimistic and Atom.optimisticFn instead. Run on diffs touching apps/web atom modules or any file that imports an effect-atom mutation atom. The hand-rolled patterns race on concurrent mutations and Multiplex has chosen the effect-atom primitives as the canonical answer for Effect-backed UI.
allowed-tools: Read Grep Glob Bash
---

You audit React code in this repo for one thing: did the author roll their own optimistic-update layer on top of an effect-atom query atom instead of using `Atom.optimistic` / `Atom.optimisticFn`?

Scope note: this applies to query/mutation atoms over server data. Multiplex
does not have those yet — today's only atom is `Atom.subscriptionRef` over the
session service (`apps/web/src/lib/effect/session-atoms.ts`); server data flows
through tRPC + TanStack Query. This skill becomes live guidance if/when server
data moves onto effect-atom (migration plan phase 5). The examples below use
Multiplex's domain but reference the future shape.

This is not a security skill. It is a correctness skill. The hand-rolled patterns have a known race condition: concurrent mutations on the same row stomp each other's `done()` calls and the UI flickers back to a stale server value. The fix is the effect-atom primitives, which track transitions and refresh authoritatively.

Trace. Do not pattern-match a `useState` and call it a day. The signal is "this state is tracking an in-flight mutation alongside an effect-atom query," not "this component uses local state."

## Trace before reporting

1. **Find the mutation.** Is the component calling `useAtomSet(<somethingMutation>)` from an `@effect/atom-react` atom module under `apps/web`? If not, this skill does not apply.
2. **Find the read.** Is the same component or its parent reading the matching list via `useAtomValue(<sameThingAtom>(...))`? If yes, the optimistic substitute exists or should exist.
3. **Find the bookkeeping.** Look for any of these alongside the mutation call:
   - `useState`, `useReducer`, `useRef` holding "pending" / "placeholder" / "in-flight" / "optimistic" values keyed by row id
   - `Atom.make` of a list / map / set of pending entries
   - Calls into helpers named like `usePending*`, `mergePending`, or `*WithPending`
   - `try { await doMutate(...) } finally { placeholder.done() }` shapes
   - Manual id minting (`pending-${...}`, `crypto.randomUUID`) in the page-level handler rather than inside an `optimisticFn` reducer
4. **Confirm the optimistic atom exists or is missing.** Open the relevant atoms module and check for `<thing>OptimisticAtom = Atom.family(... => Atom.optimistic(<thing>Atom(...)))`. If a sibling resource has the optimistic wrapper and this one doesn't, the bug is the missing wrapper plus the hand-rolled substitute.
5. **Ignore Zustand / non-atom UI.** Multiplex still has Zustand stores (`media-player-store`, prefs, etc.). Local Zustand updates are out of scope for this skill unless they are papering over an effect-atom mutation.

When the trace cannot resolve with the files at hand, drop the finding.

## What to Report

- **Hand-rolled pending state next to an effect-atom mutation.** Component imports a mutation atom and tracks the in-flight value in `useState` / `useRef` / a custom atom for immediate UI feedback. Severity: medium.
- **New pending-helper layers** that reimplement optimistic bookkeeping instead of `Atom.optimistic` + `Atom.optimisticFn`. Severity: medium.
- **`try/finally` cleanup of a placeholder around `await doMutate(...)`.** This shape is the tell. `optimisticFn` clears its own transition; manual cleanup means the author is reimplementing it. Severity: medium.
- **Reading `<thing>Atom(...)` in a component that also writes through `<thing>OptimisticAtom`'s mutations.** The reads and writes must both go through the optimistic family or both bypass it; mixing them produces visual jumps. Severity: medium.
- **`Atom.optimisticFn` reducer that derives next state from a captured snapshot of the parent atom instead of from the `current` argument.** The reducer signature is `(current, update) => W` — the runtime reads the optimistic state itself and passes it as `current`. Severity: low.
- **`Atom.optimistic` used outside an `Atom.family`.** Without `Atom.family`, every render builds a new optimistic atom and transitions don't share state. Severity: medium.

## What NOT to Report

- `useState` / `useReducer` for UI-local state that has nothing to do with mutation lifecycle: form input values, modal open flags, hover state, derived display values.
- `useState` for a "busy" / "submitting" boolean used to disable a button while the mutation runs.
- Toast / error-message state. UI feedback, not optimistic data.
- Server-only code, Syncplay protocol classes in `packages/plex-query`, and plain Zustand stores that are not bridging effect-atom mutations.
- Storybook files, test files, and example-only code.

## Severity ladder

| Level      | Criteria                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **medium** | New optimistic-mutation code that bypasses `Atom.optimistic` / `Atom.optimisticFn` and rolls its own pending state. Or a mixed read/write where the read goes through the plain query atom and the write goes through the optimistic mutation. |
| **low**    | Subtle defects in an `Atom.optimisticFn` reducer that work today but degrade under racing (clock-based identity, missing `Atom.family` wrapper, computed-once captures).                                                                        |

Do not invent `high`. Pick `low` when in doubt and explain why.

## Reference patterns (TypeScript)

Pattern source of truth: `.reference/executor` (after `bun run pull:references`) and `.reference/effect-atom`. Search executor for `Atom.optimistic` / `Atom.optimisticFn` families.

### Bad: hand-rolled pending state

```tsx
import { useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";

import { watchTogetherRoomsAtom, deleteWatchTogetherRoom } from "./atoms";

export function WatchTogetherRow() {
  const rooms = useAtomValue(watchTogetherRoomsAtom);
  const doRemove = useAtomSet(deleteWatchTogetherRoom, { mode: "promise" });
  const [pendingRemoval, setPendingRemoval] = useState<Set<string>>(new Set());

  const handleRemove = async (id: string) => {
    setPendingRemoval((s) => new Set(s).add(id));
    try {
      await doRemove({ params: { roomId: id } });
    } finally {
      setPendingRemoval((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };
}
```

### Safe: effect-atom primitives

```tsx
export const roomsOptimisticAtom = Atom.family((serverId: string) =>
  Atom.optimistic(watchTogetherRoomsAtom(serverId)),
);

export const removeRoomOptimistic = Atom.family((serverId: string) =>
  roomsOptimisticAtom(serverId).pipe(
    Atom.optimisticFn({
      reducer: (current, arg: { params: { roomId: string } }) =>
        Result.map(current, (rows) =>
          rows.filter((r) => r.id !== arg.params.roomId),
        ),
      fn: deleteWatchTogetherRoom,
    }),
  ),
);

const rooms = useAtomValue(roomsOptimisticAtom(serverId));
const doRemove = useAtomSet(removeRoomOptimistic(serverId), { mode: "promise" });

const handleRemove = (id: string) =>
  doRemove({ params: { roomId: id } });
```

### Subtle: missing Atom.family wrapper

```tsx
// Bad: builds a fresh optimistic atom every render. No transition state survives.
const optimistic = Atom.optimistic(watchTogetherRoomsAtom(serverId));
const value = useAtomValue(optimistic);
```

```tsx
// Safe: Atom.family memoizes per key so transitions persist.
export const roomsOptimisticAtom = Atom.family((serverId: string) =>
  Atom.optimistic(watchTogetherRoomsAtom(serverId)),
);

const value = useAtomValue(roomsOptimisticAtom(serverId));
```

## Output Requirements

For each finding:

- **File and line** of the offending code.
- **Severity** from the ladder above.
- **What is wrong**, in one sentence.
- **Trace**: which mutation atom, which read atom, which symptom (race / stale flicker / unmemoized atom).
- **Fix**: name the optimistic family that should exist, or the change that lifts the page's hand-rolled state into the atoms module.

Group findings by severity. Lead with `medium`.
