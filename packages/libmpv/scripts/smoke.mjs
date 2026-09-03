import { createRequire } from "node:module";
import { resolve } from "node:path";

const mediaPath = process.argv[2];
if (!mediaPath) {
  throw new Error("Usage: node scripts/smoke.mjs <media-file>");
}

const require = createRequire(import.meta.url);
const binding = require(resolve("build/Release/multiplex_libmpv.node"));

await new Promise((resolveSmoke, rejectSmoke) => {
  const timeout = setTimeout(() => {
    player.dispose();
    rejectSmoke(new Error("libmpv did not load the smoke fixture within 10 seconds."));
  }, 10_000);
  const player = binding.createPlayer((event) => {
    if (event._tag === "Error") {
      clearTimeout(timeout);
      player.dispose();
      rejectSmoke(new Error(event.message));
      return;
    }
    if (event._tag === "FileLoaded") {
      clearTimeout(timeout);
      player.stop();
      player.dispose();
      resolveSmoke();
    }
  });
  player.load({
    sourceGeneration: 1,
    url: resolve(mediaPath),
    title: "Multiplex native smoke",
    startSeconds: 0,
    volume: 0,
    muted: true,
    playbackRate: 1,
  });
});

process.stdout.write("libmpv loaded the smoke fixture\n");
