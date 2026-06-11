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
  reactCompiler: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
    // Plex Media Servers commonly live on LAN/private IPs; the image
    // optimizer must be allowed to fetch poster art from them.
    dangerouslyAllowLocalIP: true,
  },
};

export default config;
