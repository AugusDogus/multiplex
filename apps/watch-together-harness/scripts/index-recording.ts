import path from "node:path";

import { indexHarnessRecording } from "../e2e/index-recording-frames";

const recordingArgument = process.argv[2]?.trim();
if (!recordingArgument) {
  throw new Error("Usage: bun scripts/index-recording.ts <recording-path>");
}

const recordingPath = path.resolve(recordingArgument);
const frameCount = await indexHarnessRecording(recordingPath);
console.log(`Indexed ${frameCount} frames from ${recordingPath}.`);
