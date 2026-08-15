import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

export const harnessArtifactRoot = path.resolve(
  moduleDirectory,
  "../../../.watch-together-harness/artifacts",
);
