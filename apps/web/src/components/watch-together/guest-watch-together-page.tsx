"use client";

import { GuestJoinForm } from "~/components/watch-together/guest-join-form";
import { GuestLobby } from "~/components/watch-together/guest-lobby";
import { GuestUnavailable } from "~/components/watch-together/guest-unavailable";
import { useGuestWatchTogether } from "~/components/watch-together/use-guest-watch-together";

export function GuestWatchTogetherPage({ capability }: { capability: string }) {
  const {
    nickname,
    setNickname,
    joinState,
    setJoinState,
    joined,
    hostWatching,
    guestDevices,
    join,
  } = useGuestWatchTogether(capability);

  if (joinState.status === "unavailable") {
    return (
      <GuestUnavailable
        message={joinState.message}
        onRetry={() => setJoinState({ status: "form" })}
      />
    );
  }

  if (!joined) {
    return (
      <GuestJoinForm
        nickname={nickname}
        joining={joinState.status === "joining"}
        onNicknameChange={setNickname}
        onSubmit={join}
      />
    );
  }

  return (
    <GuestLobby
      hostTitle={joined.host.title}
      itemTitle={joined.item.title}
      hostWatching={hostWatching}
      nickname={nickname}
      guestDevices={guestDevices}
    />
  );
}
