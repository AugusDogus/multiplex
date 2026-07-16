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
  partialPrefetching: true,
  allowedDevOrigins: ["local.augie.haus", "multiplex.localhost"],
  // Authenticated image routes need the browser's session cookie. Plex already
  // transcodes artwork to the requested dimensions, so do not proxy it through
  // Next's optimizer (which intentionally does not forward request headers).
  images: { unoptimized: true },
};

export default config;
