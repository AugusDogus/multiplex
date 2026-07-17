# Multiplex

A 3rd party Plex client that allows you to watch TV shows and movies with your friends in perfect synchronization across all clients.

## About

Multiplex was created as a response to Plex's announcement of the deprecation of their Watch Together feature. Inspired by SyncLounge, this application ensures that you and your friends can continue to enjoy synchronized viewing experiences of your favorite content from your Plex server.

## Features

- **Synchronized Playback**: Watch content in perfect sync with friends across multiple devices
- **Real-time Controls**: Play, pause, seek, and navigate together
- **Cross-platform**: Works on any device with a web browser
- **Plex Integration**: Seamlessly connects to your existing Plex server
- **User-friendly Interface**: Clean, modern UI built with shadcn/ui components

## Tech Stack

This project is built with the following technologies:

- [Next.js](https://nextjs.org) - React framework
- [BetterAuth](https://www.better-auth.com) - Authentication
- [Drizzle](https://orm.drizzle.team) - Database ORM
- [Tailwind CSS](https://tailwindcss.com) - Styling
- [shadcn/ui](https://ui.shadcn.com) - UI components
- [tRPC](https://trpc.io) - Type-safe APIs

_This project was initially scaffolded using [create-t3-app](https://create.t3.gg/)._

## Getting Started

1. Clone the repository
2. Install dependencies: `bun install`
3. Set up your environment variables: `cp apps/web/.env.example apps/web/.env`
4. Run the development server: `bun dev`

## Deploy / PR previews

See [docs/railway-previews.md](docs/railway-previews.md). GitHub Actions owns
PR preview create/deploy/cleanup; the root `Dockerfile` is host-agnostic;
Railway is only the deploy target via the CLI.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests to help improve Multiplex.

## License

This project is open source and available under the [MIT License](LICENSE).
