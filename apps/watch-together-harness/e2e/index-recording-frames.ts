import { spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const frameSchema = z
  .object({
    key_frame: z.number().int().optional(),
    best_effort_timestamp_time: z.string().optional(),
    pkt_duration_time: z.string().optional(),
    pict_type: z.string().optional(),
  })
  .passthrough();

const probeSchema = z
  .object({
    frames: z.array(frameSchema),
  })
  .passthrough();

function runProcess(command: readonly string[]): void {
  const executable = command[0];
  if (!executable) throw new Error("Cannot run an empty command.");
  const result = spawnSync(executable, command.slice(1), {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${executable} exited with status ${result.status ?? "unknown"}: ${result.stderr.trim()}`,
    );
  }
}

export async function indexHarnessRecording(recordingPath: string): Promise<number> {
  const probePath = `${recordingPath}.probe-${process.pid}.json`;
  try {
    runProcess([
      "ffprobe",
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "frame=best_effort_timestamp_time,pkt_duration_time,key_frame,pict_type",
      "-of",
      "json",
      "-o",
      probePath,
      recordingPath,
    ]);
  } catch (error) {
    await unlink(probePath).catch(() => undefined);
    throw error;
  }
  const output = await readFile(probePath, "utf8");
  await unlink(probePath);
  const parsed: unknown = JSON.parse(output);
  const probe = probeSchema.parse(parsed);
  const manifestPath = `${recordingPath}.frames.json`;
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        recording: path.basename(recordingPath),
        frameCount: probe.frames.length,
        frames: probe.frames,
      },
      null,
      2,
    )}\n`,
  );

  if (process.env.WATCH_TOGETHER_HARNESS_EXTRACT_FRAMES === "1") {
    const frameDirectory = `${recordingPath}.frames`;
    await mkdir(frameDirectory, { recursive: true });
    runProcess([
      "ffmpeg",
      "-v",
      "error",
      "-i",
      recordingPath,
      "-vsync",
      "0",
      path.join(frameDirectory, "frame-%08d.png"),
    ]);
  }

  return probe.frames.length;
}

export async function indexHarnessRecordings(root: string): Promise<void> {
  const recordings = await findRecordings(root);

  for (const recording of recordings) {
    const frameCount = await indexHarnessRecording(recording);
    console.log(`Indexed ${frameCount} frames from ${path.relative(root, recording)}.`);
  }
}

async function findRecordings(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const recordings: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      recordings.push(...(await findRecordings(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".webm")) {
      recordings.push(entryPath);
    }
  }
  return recordings;
}
