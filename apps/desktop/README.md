# Multiplex desktop

This is the native desktop Multiplex client. Its application core is restricted TypeScript compiled into native code. Its interface is `.native` markup rendered by Vercel's [Native SDK](https://github.com/vercel-labs/native). It does not embed the Multiplex website.

The hosted Multiplex deployment remains the backend authority for device pairing, Plex account access, metadata, playback session planning, timeline reporting, and Watch Together. Production packages contain only the native client, metadata, and assets. They contain no Next.js output, Bun runtime, SQLite database, Plex credentials, or server secrets.

## Run

Run the native client:

```sh
bun install
bun run desktop:dev
```

Use the local hosted backend during API integration work:

```sh
bun run desktop:dev:local
```

This command does not display the web app. It only supplies `https://multiplex.localhost` as the API origin.

## Build and package

```sh
bun run desktop:build
bun run desktop:package:macos
bun run desktop:package:linux
bun run desktop:package:windows
```

Package each target on its native operating system.

## Current native surface

The desktop client currently includes native pairing, home shelves, libraries, browse, search, details, player controls, subtitle selection, and Watch Together room screens. Native SDK provides the media surface and playback commands.

The desktop layout follows the web client's sidebar, shelves, search, details, and player hierarchy. The next integration slice connects those screens to the hosted device API and replaces the bundled preview catalog with Plex account data.

## Checks

```sh
bun --filter @multiplex/desktop typecheck
bun --filter @multiplex/desktop test
```

The checks require no Plex account. They compile the TypeScript core into native code and validate the complete `.native` view contract.
