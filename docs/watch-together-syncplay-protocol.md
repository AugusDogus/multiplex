# Plex Watch Together syncplay protocol notes

Reverse-engineered from Plex Web `plex-4.159.0` and verified against live
`together.plex.tv` on 2026-06-24.

## Official UI flow

1. Open a playable item details page in Plex Web.
2. Open the More menu.
3. Select `Watch Together...`.
4. Plex shows a `Watch Together` dialog with `Friends and Accounts with Library
Access`, `Cancel`, and `Invite`.
5. The room is created only after confirming the invite flow.

## Room REST API

Base URL comes from Plex Web's `watchtogether` service environment:

- Production base: `https://together.plex.tv`
- Auth: `X-Plex-Token: <plex auth token>`

### List rooms

`GET /rooms`

Response envelope:

```json
{
  "rooms": []
}
```

Plex Web also refreshes this list when pubsub commands
`notifyWatchTogetherInvite` or `notifyWatchTogetherExpire` arrive.

### Create room

`POST /rooms`

Body:

```json
{
  "sourceUri": "server://<machineIdentifier>/com.plexapp.plugins.library/library/metadata/<ratingKey>",
  "title": "<item title>",
  "users": [12345]
}
```

`users` can be `null` or omitted to create a room without inviting additional
users.

Observed response:

```json
{
  "id": "<room id>",
  "sourceUri": "server://...",
  "source": "server://...",
  "title": "12 Angry Men",
  "type": "watch",
  "startsAt": 1782339898,
  "endsAt": 1782350698,
  "updatedAt": 1782339898,
  "syncplayHost": "pop-atl00.syncplay.plex.services",
  "syncplayPort": 7777,
  "users": [
    {
      "id": 559216671,
      "title": "multiplextest",
      "username": "multiplextest",
      "thumb": "..."
    }
  ]
}
```

### Invite users

`POST /rooms/{roomID}/invite`

Body:

```json
{
  "users": [12345]
}
```

### Get or delete a room

- `GET /rooms/{roomID}`
- `DELETE /rooms/{roomID}`

Plex Web tolerates `404` while deleting and refreshes the room list after
create, invite, and delete.

## Syncplay websocket

The room response supplies the socket location:

```text
wss://{syncplayHost}:{syncplayPort}/ws
```

The underlying websocket wrapper disables its own 30-second `"hello"` ping for
syncplay sessions.

### User encoding

The `username` field is a JSON string, not an object:

```json
{
  "deviceIdentifier": "<X-Plex-Client-Identifier>",
  "deviceName": "<X-Plex-Device-Name>",
  "userID": "559216671"
}
```

Plex's parser strips trailing underscores before parsing the string.

### Hello

Client sends after socket open:

```json
{
  "Hello": {
    "room": { "name": "<roomID>" },
    "username": "{\"deviceIdentifier\":\"...\",\"deviceName\":\"...\",\"userID\":\"...\"}",
    "version": "1.6.4"
  }
}
```

Server replies with the same shape plus `realversion` and feature flags:

```json
{
  "Hello": {
    "room": { "name": "<roomID>" },
    "username": "{\"deviceIdentifier\":\"...\",\"deviceName\":\"...\",\"userID\":\"...\"}",
    "version": "1.6.4",
    "realversion": "1.6.5",
    "motd": "",
    "features": {
      "isolateRooms": true,
      "readiness": true,
      "managedRooms": true,
      "chat": false,
      "maxChatMessageLength": 150,
      "maxUsernameLength": 150,
      "maxRoomNameLength": 36,
      "maxFilenameLength": 250
    }
  }
}
```

### List

Client sends:

```json
{ "List": {} }
```

Server replies keyed by room id, then encoded username:

```json
{
  "List": {
    "<roomID>": {
      "{\"deviceIdentifier\":\"...\",\"deviceName\":\"...\",\"userID\":\"...\"}": {
        "position": 0,
        "file": {},
        "controller": false,
        "isReady": true,
        "features": {
          "sharedPlaylists": true,
          "chat": true,
          "featureList": false,
          "readiness": true,
          "managedRooms": true
        }
      }
    }
  }
}
```

### Set readiness

Server initially emits readiness as `null` for the joining client:

```json
{
  "Set": {
    "ready": {
      "username": "{\"deviceIdentifier\":\"...\",\"deviceName\":\"...\",\"userID\":\"...\"}",
      "isReady": null,
      "manuallyInitiated": false
    }
  }
}
```

Client can update readiness:

```json
{
  "Set": {
    "ready": {
      "isReady": true
    }
  }
}
```

Server echoes the update with `username`.

### Set file

Plex Web sends `Set.file` when the current source URI or ad state changes:

```json
{
  "Set": {
    "file": {
      "name": "{\"ads\":{\"playing\":false},\"uri\":\"server://...\"}"
    }
  }
}
```

The nested `name` payload is a JSON string. `ads` can include:

- `playing`
- `index`
- `count`
- `breakPosition`

Server `Set.user` payloads can include room membership events:

```json
{
  "Set": {
    "user": {
      "{\"deviceIdentifier\":\"...\",\"deviceName\":\"...\",\"userID\":\"...\"}": {
        "room": { "name": "<roomID>" },
        "file": {
          "name": "{\"ads\":{\"playing\":false},\"uri\":\"server://...\"}"
        },
        "event": { "joined": true, "left": false }
      }
    }
  }
}
```

### State

Client sends playback state after each server state tick:

```json
{
  "State": {
    "ping": {
      "clientLatencyCalculation": 0,
      "clientRtt": 0,
      "serverRtt": 0,
      "latencyCalculation": 0
    },
    "playstate": {
      "doSeek": true,
      "paused": true,
      "position": 12,
      "setBy": null
    },
    "ignoringOnTheFly": {
      "client": 0,
      "server": 0
    }
  }
}
```

Server echoes:

```json
{
  "State": {
    "ping": {
      "latencyCalculation": 1782339911.6879451,
      "serverRtt": 0
    },
    "playstate": {
      "position": 12,
      "paused": true,
      "doSeek": true,
      "setBy": "{\"deviceIdentifier\":\"...\",\"deviceName\":\"...\",\"userID\":\"...\"}"
    },
    "ignoringOnTheFly": {
      "server": 1
    }
  }
}
```

Plex Web ignores state frames set by the local `deviceIdentifier`. For remote
frames, it emits:

- Pause if remote `paused` is `true` and local player is not paused.
- Resume if remote `paused` is `false` and local player is paused.
- Seek when `doSeek` is true.
- Drift correction seek when local position is at least 4 seconds ahead or at
  least 1.75 seconds behind the remote position.
- Temporary playback speed `0.95` when local playback is more than 1.5 seconds
  ahead but below the seek threshold.

When playing, Plex adjusts the remote position by the last forward-delay
calculation before applying it locally.

## Player bridge behavior

Plex Web's syncplay session manager bridges the player with:

- `hasInitialBuffer`: true when `canPlayThrough` is true or the buffered range
  contains `positionSeconds + 5`.
- `hasPendingPlayPause`: set when local play/pause action occurs.
- `hasPendingSeek`: set when local seek action occurs.
- `isPaused`: current player pause state.
- `isPlayerForeground`: false while the Watch Together lobby is visible.
- `positionSeconds`: `lastSeekPositionSeconds` if present, otherwise current
  `positionSeconds`.

Readiness is true only when no ad is playing and the player has initial buffer.

## Implementation implications for Multiplex

- No Multiplex Drizzle schema is needed for official Plex Watch Together rooms.
  Room state is owned by `together.plex.tv`.
- Add a Plex Watch Together client around the REST room service plus syncplay
  websocket.
- Use the existing `buildLibraryItemUri` source URI format for room creation.
- Wire remote `State.playstate` frames to `media-player-store` / `useMediaPlayer`
  pause, play, and seek actions.
- Track a local device identifier so local echoed state is ignored.
- Preserve Plex's drift thresholds before adding more aggressive correction.
