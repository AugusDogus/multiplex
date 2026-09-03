import { defineConfig } from "vite-plus";

const shared = {
  format: "cjs" as const,
  outDir: "dist-electron",
  sourcemap: true,
  outExtensions: () => ({ js: ".cjs" }),
};

export default defineConfig({
  pack: [
    {
      ...shared,
      entry: ["src/main.ts"],
      clean: true,
      deps: {
        alwaysBundle: (id) => id.startsWith("@multiplex/"),
      },
    },
    {
      ...shared,
      entry: ["src/preload.ts"],
      deps: {
        alwaysBundle: (id) => id.startsWith("@multiplex/"),
      },
    },
  ],
});
