import { useState } from "react";
import {
  getNextPinnedSources,
  getPinnedSourceIdentity,
  type PinnedSource,
  type PlexUserInfo,
  toPinnedSource,
} from "@multiplex/plex-query";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

import { asUserInfo } from "~/lib/effect/plex-boundary";
import {
  togglePinnedSource,
  togglePinnedSourceOptimistic,
  userInfoOptimisticAtom,
} from "~/lib/effect/plex-browse-atoms";
import { pinnedSourceWriteKeys } from "~/lib/effect/reactivity-keys";

function applyPinnedSourceUpdate(
  userInfo: PlexUserInfo,
  source: PinnedSource,
  action: "pin" | "unpin",
): PlexUserInfo {
  const currentSettings = userInfo.settings ?? { otherSettings: {} };

  return {
    ...userInfo,
    settings: {
      ...currentSettings,
      sidebarSettings: {
        ...currentSettings.sidebarSettings,
        hasCompletedSetup:
          currentSettings.sidebarSettings?.hasCompletedSetup ?? true,
        pinnedSources: getNextPinnedSources(
          currentSettings.sidebarSettings?.pinnedSources ?? [],
          source,
          action,
        ),
      },
    },
  };
}

/**
 * Sidebar pin/unpin.
 *
 * Once `userInfoOptimisticAtom` has a settled value, reads and writes go
 * through the shared optimistic family (instant pin/unpin + automatic
 * rollback). Until then the atom's reducer is a no-op on `Initial`, so we
 * mirror the former local-override semantics against the RSC `userInfo` prop.
 */
export function useSidebarPinning(userInfo: PlexUserInfo) {
  const optimisticResult = useAtomValue(userInfoOptimisticAtom);
  const togglePinnedOptimistic = useAtomSet(togglePinnedSourceOptimistic, {
    mode: "promiseExit",
  });
  const togglePinnedPlain = useAtomSet(togglePinnedSource, {
    mode: "promiseExit",
  });
  const [userInfoOverride, setUserInfoOverride] = useState<PlexUserInfo | null>(
    null,
  );
  const [pendingSourceIdentity, setPendingSourceIdentity] = useState<
    string | null
  >(null);

  const atomUserInfo = Option.getOrUndefined(
    Option.map(AsyncResult.value(optimisticResult), asUserInfo),
  );
  // Prefer the optimistic atom once settled; until then use local override /
  // RSC prop (override is ignored once the atom owns the value).
  const currentUserInfo = atomUserInfo ?? userInfoOverride ?? userInfo;

  function handleTogglePinnedSource(
    source: PinnedSource,
    action: "pin" | "unpin",
  ) {
    const pinnedSource = toPinnedSource(source);
    setPendingSourceIdentity(getPinnedSourceIdentity(pinnedSource));

    void (async () => {
      if (atomUserInfo !== undefined) {
        const exit = await togglePinnedOptimistic({
          payload: { action, source: pinnedSource },
          reactivityKeys: [...pinnedSourceWriteKeys],
        });
        setPendingSourceIdentity(null);
        if (Exit.isFailure(exit)) {
          return;
        }
        return;
      }

      // Atom still Initial — local override mirrors former onMutate/onError.
      const previousOverride = userInfoOverride;
      setUserInfoOverride(
        applyPinnedSourceUpdate(currentUserInfo, pinnedSource, action),
      );
      const exit = await togglePinnedPlain({
        payload: { action, source: pinnedSource },
        reactivityKeys: [...pinnedSourceWriteKeys],
      });
      setPendingSourceIdentity(null);
      if (Exit.isFailure(exit)) {
        setUserInfoOverride(previousOverride);
        return;
      }
    })();
  }

  return {
    currentUserInfo,
    pendingSourceIdentity,
    handleTogglePinnedSource,
  };
}
