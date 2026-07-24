/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Hide the floating dev indicator so it doesn't visually collide with the
  // mobile bottom navigation while developing / recording demos.
  devIndicators: false,
  reactStrictMode: true,
  reactCompiler: true,
  cacheComponents: true,
  // Soft-nav must feel like Plex's SPA: prefetch shells + reuse recent
  // navigations instead of paying a full RSC round-trip on every click.
  partialPrefetching: true,
  experimental: {
    // Keep dynamic segments reusable after the first soft-nav / prefetch.
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
    // Seed the client cache from completed navigations for instant revisits.
    // 'allow-runtime' also caches session-bound prerenders (library/details).
    cachedNavigations: "allow-runtime",
    // Prefetch loading shells once per route pattern.
    appShells: true,
    // Start dynamic/runtime prefetch work on link hover, not only viewport.
    dynamicOnHover: true,
    // Opt into React <ViewTransition> during App Router navigations (library
    // pivot tabs morph the active pill between selections).
    viewTransition: true,
  },
  allowedDevOrigins: [
    "local.augie.haus",
    "multiplex.localhost",
    "127.0.0.1",
    "localhost",
  ],
  // Artwork loads directly from PMS (`/photo/:/transcode` with X-Plex-Token).
  // Keep Next's optimizer off so cross-origin plex.direct URLs are not rewritten.
  images: { unoptimized: true },
};

export default config;
