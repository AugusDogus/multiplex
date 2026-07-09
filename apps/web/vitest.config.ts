import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Playwright specs live in e2e/ and must never run under vitest.
    include: ["src/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
  },
});
