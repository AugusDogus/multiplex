---
name: effect-atom-reactivity-keys
description: Add reactivityKeys to effect-atom write mutation calls. Use when lint or review flags a useAtomSet mutation call that mutates data without invalidation keys.
allowed-tools: Read Grep Glob Bash
---

Effect-atom write mutations must say which reads they invalidate.

Scope note: this applies to `AtomHttpApi`-style query/mutation atoms. Multiplex
does not use those yet — the current bridge is `Atom.subscriptionRef` over the
session service plus a command facade (`apps/web/src/lib/effect/session-atoms.ts`),
and server data still flows through tRPC + TanStack Query. This skill becomes
live guidance if/when server data moves onto effect-atom (migration plan
phase 5). Pattern source: `.reference/executor` after `bun run pull:references`.

## Fix Shape

- Find the `useAtomSet(...)` write mutation call.
- Add `reactivityKeys` to the mutation payload at the call site.
- Use the narrowest keys that cover the rows/lists affected by the write.
- Keep read-only probe/preview flows out of this pattern.
- If the mutation should update UI immediately, check whether `effect-atom-optimistic` also applies.

## Good

```ts
await deleteWatchTogetherRoom({
  params: { roomId },
  reactivityKeys: [["watchTogetherRooms"]],
});
```
