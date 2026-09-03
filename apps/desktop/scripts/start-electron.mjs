import { spawn } from "node:child_process";

import { desktopDirectory, resolveElectronPath } from "./electron-launcher.mjs";

const childEnvironment = { ...process.env };
delete childEnvironment.ELECTRON_RUN_AS_NODE;

const child = spawn(resolveElectronPath(), ["dist-electron/main.cjs"], {
  cwd: desktopDirectory,
  env: childEnvironment,
  stdio: "inherit",
});

child.once("exit", (code) => process.exit(code ?? 0));
