# Mobile architecture

## Problem

Multiplex needs a native Expo client without creating a second Plex backend. The web app already owns Plex authentication, server discovery, validation, playlists, Live TV, and Watch Together room operations through its typed tRPC router. The mobile app must keep those rules authoritative while replacing browser-only navigation, storage, and video controls.

## Usage

Run the web API and mobile bundler together:

```sh
bun dev
bun mobile
```

Set `EXPO_PUBLIC_API_URL` for a device that cannot reach the development host automatically:

```sh
EXPO_PUBLIC_API_URL=https://multiplex.example bun mobile
```

The app requests a short device-link code, opens the existing `/link` flow, polls Better Auth for a bearer token, and stores that token in SecureStore. Every tRPC request sends the bearer token to the existing protected procedures.

## Shape

`AuthProvider` owns one discriminated auth state and exposes `beginLink`, `cancelLink`, and `signOut`. It hides SecureStore, device-code polling, expiry, and bearer-token restoration.

`api` is a typed tRPC client derived from the web router. It adds the bearer token at the request boundary and keeps Plex transport types out of screens.

`RootNavigator` owns native route state. The bottom tabs cover Home, Search, Libraries, and More. Stack routes cover media details, browse pivots, playlists, Live TV, Watch Together, profile, and the full-screen player.

`PlayerScreen` adapts Expo Video to Multiplex playback. Plex URL generation and timeline reporting stay behind the player module. Watch Together uses the shared `SyncplaySessionController` and room-rotation policy, so native and web players share synchronization and next-episode behavior.

Trusted Guest links are supported on both sides. Signed-in hosts can verify or enable Plex Home Guest, create a capability link, persist it in SecureStore, and share it from the room. Account-free guests can open a `multiplex://` deep link or paste the HTTPS invite, then join the lobby and play with a transient Plex token. Guest response schemas and Syncplay identity rules live in `@multiplex/plex-query` so both clients parse the same protocol.

The public interfaces stay small because each module owns its boundary. Screens ask for domain operations and receive parsed router outputs. They do not coordinate cookies, raw Plex requests, or session storage.

## Synthesis decision

Candidate A used the existing Next and tRPC backend as the only Plex authority. Candidate B put `PlexTvClient` and Plex tokens directly in the app. Candidate A won because it hides connection selection, request validation, playlist mutation rules, and auth token refresh behind one API. The native video adapter and SecureStore-backed bearer session were retained from Candidate B because those concerns belong on the device. Direct Plex data fetching was rejected.

## Tradeoffs accepted

- We accept that local development needs the Next server in exchange for one source of truth for Plex behavior.
- We accept a device-link login step in exchange for never handing Plex credentials or the browser session cookie to native code.
- We accept platform-specific player controls in exchange for native playback and full-screen behavior.

## Alternatives considered

A direct Plex client in Expo would work offline from the Multiplex server after login, but it exposes server selection, token handling, response parsing, and mutation behavior to every screen. Its interface is wider and would drift from the web client.

A WebView wrapper would inherit web parity, but it would not be a native mobile app and could not use HeroUI Native or native video controls meaningfully.

## Open questions and risks

- Which production API origin should release builds use when `EXPO_PUBLIC_API_URL` is absent?
- Should mobile device grants use a narrower scope after Better Auth supports scope enforcement for these procedures?
- Which iOS and Android bundle identifiers should replace the temporary `app.multiplex.mobile` identifiers before store submission?

## Feature surface

The native routes cover Home hubs and continue watching, global search, pinned sources, all library pivots, content types, sorts and filters, hub pagination, item and season details, watched state, playlist creation and editing, Live TV, account profile, authenticated Watch Together, trusted guest hosting and joining, playback streams and subtitles, markers, timeline reporting, solo autoplay, and synchronized room rotation.
