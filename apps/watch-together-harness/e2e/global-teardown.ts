import { harnessArtifactRoot } from "./artifact-paths";
import { indexHarnessRecordings } from "./index-recording-frames";

export default async function globalTeardown(): Promise<void> {
  await indexHarnessRecordings(harnessArtifactRoot);
}
