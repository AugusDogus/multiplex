import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
export const desktopDirectory = resolve(currentDirectory, "..");

export function resolveElectronPath() {
  const require = createRequire(import.meta.url);
  return require("electron");
}
