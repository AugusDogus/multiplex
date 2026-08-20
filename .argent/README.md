# Run the mobile Argent suites

Argent runs the Expo app on an installed Android emulator build. The flows use `app.multiplex.mobile` and stable React Native test IDs.

## Test a signed-out installation

Install a clean app build so SecureStore has no Plex token. Start the API and Metro services that the Expo development build uses. Then run:

```sh
bun run test:argent:mobile:signed-out
```

This suite verifies the login screen and malformed guest-invite handling.

## Test signed-in flows

Expose the existing multiplextest variables to Argent without copying their values:

```sh
ln -s ../apps/web/.env .argent/secrets.env
```

The linked file must define `MULTIPLEX_ACCOUNT_EMAIL` and `MULTIPLEX_ACCOUNT_PASSWORD`. It is ignored by Git.

Initialize the local database, then keep the web API and Metro running:

```sh
bun db:push
bun run dev:app
bun mobile
```

Install the Android development build and run:

```sh
bun mobile:android
bun run test:argent:mobile:signed-in
```

The suite links the app through the real Plex browser flow when no mobile session exists. It reuses an active Plex browser session when available. It verifies all primary tabs and the Profile, Watch Together, and Live TV routes, then signs out of the mobile app to restore the baseline. It does not create rooms, alter libraries, or start playback.

Both commands target Android by default. To run one flow on iOS, call Argent directly and change the platform:

```sh
bunx argent flow run .argent/flows/mobile/signed-out/login.yaml --platform ios
```

Argent writes failure screenshots and diffs to `.argent/artifacts/`. The directory is ignored by Git.
