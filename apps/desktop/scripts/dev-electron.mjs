import { spawn } from "node:child_process";

import { desktopDirectory, resolveElectronPath } from "./electron-launcher.mjs";
import { waitForResources } from "./wait-for-resources.mjs";

const webPort = Number(process.env.MULTIPLEX_WEB_PORT ?? 3000);
await waitForResources({
  baseDir: desktopDirectory,
  files: ["dist-electron/main.cjs", "dist-electron/preload.cjs"],
  port: webPort,
});

const childEnvironment = { ...process.env };
delete childEnvironment.ELECTRON_RUN_AS_NODE;

const child = spawn(resolveElectronPath(), ["dist-electron/main.cjs"], {
  cwd: desktopDirectory,
  env: {
    ...childEnvironment,
    MULTIPLEX_DESKTOP_DEV_SERVER_URL: `http://127.0.0.1:${webPort}`,
  },
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal));
}

child.once("exit", (code) => process.exit(code ?? 0));
