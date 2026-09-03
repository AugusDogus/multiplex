# Multiplex

A 3rd party Plex client that allows you to watch TV shows and movies with your friends in perfect synchronization across all clients.

## About

Multiplex was created as a response to Plex's announcement of the deprecation of their Watch Together feature. Inspired by SyncLounge, this application ensures that you and your friends can continue to enjoy synchronized viewing experiences of your favorite content from your Plex server.

Live authenticated, Guest Link, and GameCube validation is documented in
[Watch Together testing](docs/watch-together-testing.md).

## Features

- **Synchronized Playback**: Watch content in perfect sync with friends across multiple devices
- **Real-time Controls**: Play, pause, seek, and navigate together
- **Cross-platform**: Works in any web browser, with native console clients in development
- **Plex Integration**: Seamlessly connects to your existing Plex server
- **User-friendly Interface**: Clean, modern UI built with shadcn/ui components

## Tech Stack

Multiplex is a [Bun](https://bun.sh) monorepo: the web app lives in `apps/web`, shared Plex API and auth libraries in `packages/`, and native console clients live in `apps/gamecube`, `apps/wii`, and `apps/dreamcast`.

### Web (`apps/web`)

- [Next.js](https://nextjs.org) - React framework
- [BetterAuth](https://www.better-auth.com) - Authentication
- [Drizzle](https://orm.drizzle.team) - Database ORM
- [Tailwind CSS](https://tailwindcss.com) - Styling
- [shadcn/ui](https://ui.shadcn.com) - UI components
- [tRPC](https://trpc.io) - Type-safe APIs
- [TanStack Query](https://tanstack.com/query) - Server-state caching
- [Effect](https://effect.website) - Player and Watch Together session runtime

### Consoles

- [Native SDK](https://github.com/vercel-labs/native) - GameCube and Wii UI authored in restricted TypeScript and `.native` markup
- [libogc2](https://github.com/extremscorner/libogc2) - Console runtime and networking
- [MPlayer CE](https://github.com/SuperrSonic/mplayer-ce-libogc2) - Console-optimized FFmpeg video/audio decoding
- [Mbed TLS](https://github.com/Mbed-TLS/mbedtls) - HTTPS on console
- [KallistiOS](https://kos-docs.dreamcast.wiki/) - Dreamcast C runtime, input, networking, and PVR access

See [`apps/gamecube/README.md`](apps/gamecube/README.md), [`apps/wii/README.md`](apps/wii/README.md), and [`apps/dreamcast/README.md`](apps/dreamcast/README.md) for target status and acknowledgements.

_This project was initially scaffolded using [create-t3-app](https://create.t3.gg/)._

## Getting Started

1. Clone the repository
2. Install dependencies: `bun install`
3. Set up your environment variables: `cp apps/web/.env.example apps/web/.env`
4. Run the development server: `bun dev`

The app is available at `https://multiplex.localhost` through Portless.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests to help improve Multiplex.

## License

This project is open source and available under the [MIT License](LICENSE). The native console apps are the exception: they are GPL-3.0-or-later so they can build on GPL-licensed homebrew media work. See the [shared console UI license](packages/console-ui/LICENSE.md) and [Dreamcast app license](apps/dreamcast/LICENSE.md).
