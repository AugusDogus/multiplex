import * as FileSystem from "node:fs/promises";
import * as Net from "node:net";
import * as Path from "node:path";
import * as Timers from "node:timers/promises";

async function fileExists(filePath) {
  try {
    await FileSystem.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function portIsReady(port) {
  return new Promise((resolve) => {
    const socket = Net.createConnection({ host: "127.0.0.1", port });
    const finish = (ready) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ready);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}

export async function waitForResources({ baseDir, files, port, timeoutMs = 120_000 }) {
  const startedAt = Date.now();
  while (true) {
    const fileStates = await Promise.all(
      files.map((file) => fileExists(Path.resolve(baseDir, file))),
    );
    if (fileStates.every(Boolean) && (await portIsReady(port))) return;
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for desktop resources on port ${port}.`);
    }
    await Timers.setTimeout(100);
  }
}
