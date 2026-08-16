# Watch Together testing

The live Watch Together gate covers the supported client matrix against a real
Plex server:

| Command                                | Coverage                                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run test:watch-together:web`      | Two authenticated web accounts, a real unauthenticated Guest Link, and the portable two-player direct-play and transcode harnesses   |
| `bun run test:watch-together:gamecube` | GameCube plus an authenticated web participant through lifecycle recovery, reconnect, rapid seeks, and final-second episode rotation |
| `bun run test:watch-together`          | Both suites above, in order                                                                                                          |

All live tests use zero retries. A first-attempt failure remains visible.

## Prerequisites

1. Run `bun install`.
2. Put both test accounts in `apps/web/.env`:

   ```dotenv
   MULTIPLEX_ACCOUNT_EMAIL=account-a@example.com
   MULTIPLEX_ACCOUNT_PASSWORD=account-a-password
   MUTLIPLEX_ACCOUNT_EMAIL_2=account-b@example.com
   MULTIPLEX_ACCOUNT_PASSWORD_2=account-b-password
   ```

   `MUTLIPLEX_ACCOUNT_EMAIL_2` retains the existing misspelling for
   compatibility. Dedicated `WATCH_TOGETHER_ACCOUNT_A_*` and
   `WATCH_TOGETHER_ACCOUNT_B_*` variables are also accepted by the portable
   harness.

3. Give both accounts access to the same Plex server and media library.
4. Install Google Chrome with H.264/AAC support.
5. Before the GameCube suite, run `bun run gamecube:dolphin:bootstrap` and
   `bun run gamecube:setup` once. The runner reports any missing host utilities.

The root runner selects its environment file in this order:

1. `WATCH_TOGETHER_ENV_FILE`
2. This worktree's `apps/web/.env`
3. The primary checkout's `apps/web/.env`, resolved through Git's common
   directory

It passes that file to Bun directly. Do not manually `source` it. This keeps
quoted passwords intact and makes the same commands work from linked
worktrees. Chrome is resolved through the shared harness resolver, not a
command-specific executable path.

The runner prunes crashed Portless sessions and takes over a stale
`multiplex.localhost` route before starting the application. Active routes are
left running and a responding Multiplex server is reused.

## What the web gate proves

The production application tests create rooms through the real UI and cover:

- authenticated host and participant playback
- an unauthenticated Guest Link from creation through join
- simultaneous conflicting seeks and play/pause storms
- complete network loss and recovery within the five-second budget
- a deliberately aborted Plex transcode followed by playback recovery
- host reload, participant tab recreation, and Guest Link capability reload
- sustained drift checks and two consecutive episode rotations

The portable harness then runs the shared Syncplay controller with two real
Plex tokens in one page. It repeats pause, resume, seek, reconnect, rapid seek,
and final-second handoff for direct playback and offset transcoding. Every run
uses the dynamically resolved Home fixture, records video, and writes a
manifest containing every decoded frame. Set
`WATCH_TOGETHER_HARNESS_SERVER_ID` when the accounts share more than one Plex
server and the default server is not the intended target.

## What the GameCube gate proves

The GameCube runner starts or reuses `https://multiplex.localhost`, refreshes
both web sessions, provisions isolated console credentials, and dynamically
selects the first playable Home item with a successor. It also derives the
authenticated web participant's Plex user ID from account B's token, so no
personal account or fixed invitee ID is embedded in the command.

It runs two Dolphin cases:

1. Bidirectional pause, resume, and seek, a cold Chrome participant restart,
   GameCube reconnect within five seconds, and host disband.
2. Rapid seeks through 10%, 80%, 30%, 90%, 20%, 70%, 40%, and 60%, followed by
   a seek into the final second and synchronized successor-room rotation.

Both cases fail on ISI exceptions, decoder failures, invalid memory access,
audio underruns, UI layout damage, participant divergence, or missed recovery
budgets. Dolphin is recorded at 60 fps and every captured frame is indexed.

## Artifacts and cleanup

Web recordings, traces, redacted journals, Dolphin recordings, final frames,
and frame manifests are stored below `.watch-together-harness/artifacts`.
Private tokens and console state remain in ignored files with mode `0600`.
Rooms and Plex transcode sessions are cleaned up by the harnesses, including
after failures.

The full gate uses real transcode capacity and can take several minutes. Run
the scoped web or GameCube command while iterating, then run the combined gate
before merging changes that affect playback, Syncplay, room lifecycle,
rotation, authentication, Plex transport, or console networking.
