import type * as Mediabunny from "mediabunny";
import type {
  AudioCodec,
  EncodedAudioPacketSource,
  EncodedVideoPacketSource,
  AudioSampleSource,
  Input,
  InputAudioTrack,
  InputVideoTrack,
  Output,
} from "mediabunny";
import {
  BACK_BUFFER_SECONDS,
  FORWARD_BUFFER_SECONDS,
  INTERLEAVE_WINDOW_SECONDS,
  MIN_FORWARD_BUFFER_SECONDS,
  bufferedToRanges,
  clampPumpStartTime,
  computeEvictionEnd,
  shouldRestartPumpForSeek,
} from "./client-remux-logic";

/* ────────────────────────────────────────────────────────────
   Client Remux Engine
   Plays "H.264 video + audio the browser can't decode" media without a Plex
   server transcode: video packets are copied as-is and audio is decoded and
   re-encoded to AAC in the browser (via Mediabunny), muxed into fragmented
   MP4, and streamed into a MediaSource. Because the output keeps the
   original timestamps, the <video> element exposes the real timeline:
   currentTime, buffered ranges, and native seeking all behave like
   direct play.

   Seeking outside the buffered/upcoming region restarts the pump at the
   key frame preceding the target. Buffered media is bounded by a forward
   window and back-buffer eviction so long items never exhaust the
   browser's SourceBuffer quota.
   ──────────────────────────────────────────────────────────── */

type MediabunnyModule = typeof Mediabunny;

const AAC_TRANSCODE_BITRATE = 192_000;
const URL_SOURCE_CACHE_BYTES = 32 * 1024 * 1024;
const EVICTION_CHECK_INTERVAL_MS = 10_000;
const MAX_QUOTA_RETRIES = 4;

let mediabunnyModulePromise: Promise<MediabunnyModule> | null = null;
let codecExtensionsPromise: Promise<void> | null = null;

// Dynamic imports are deliberate here (documented exception to the
// no-inline-imports rule): Mediabunny and its codec extensions add several
// hundred KB and must stay out of the main bundle until a client-remux
// playback actually starts.
async function loadMediabunny(): Promise<MediabunnyModule> {
  mediabunnyModulePromise ??= import("mediabunny");
  return mediabunnyModulePromise;
}

async function registerCodecExtensions(): Promise<void> {
  codecExtensionsPromise ??= (async () => {
    const [mediabunny, ac3, aacEncoder] = await Promise.all([
      loadMediabunny(),
      import("@mediabunny/ac3"),
      import("@mediabunny/aac-encoder"),
    ]);

    ac3.registerAc3Decoder();
    // Prefer the browser's native AAC encoder; register the WASM encoder only
    // where WebCodecs cannot encode AAC (e.g. Firefox).
    if (!(await mediabunny.canEncodeAudio("aac"))) {
      aacEncoder.registerAacEncoder();
    }
  })();
  return codecExtensionsPromise;
}

/** Audio codecs the browser can play from an MP4 container without help. */
const MSE_COPYABLE_AUDIO_CODECS: ReadonlySet<AudioCodec> = new Set<AudioCodec>([
  "aac",
  "mp3",
  "opus",
  "flac",
]);

type AudioPipelinePlan =
  | { kind: "none" }
  | {
      kind: "copy";
      codec: AudioCodec;
      track: InputAudioTrack;
      decoderConfig: AudioDecoderConfig | null;
    }
  | { kind: "transcode"; track: InputAudioTrack; numberOfChannels: number };

export interface ClientRemuxPipelineInfo {
  mimeType: string;
  videoCodecString: string;
  audioMode: AudioPipelinePlan["kind"];
  duration: number | null;
}

export interface ClientRemuxPlaybackOptions {
  video: HTMLVideoElement;
  /** Direct URL of the original media file on the Plex server. */
  mediaUrl: string;
  /** Timeline position (seconds) to start feeding from. */
  startTime: number;
  /**
   * Fired once for unrecoverable failures (probe mismatch, decoder error,
   * append failure). The engine has already detached itself when this fires;
   * the caller is expected to fall back to Plex streaming.
   */
  onFatalError: (error: unknown) => void;
}

export interface ClientRemuxPlaybackHandle {
  info: ClientRemuxPipelineInfo;
  destroy: () => void;
}

interface InterleaveCoordinator {
  head: () => number;
  update: (kind: "video" | "audio", timestamp: number) => void;
  markDone: (kind: "video" | "audio") => void;
  waitForOther: (kind: "video" | "audio", timestamp: number) => Promise<void>;
  release: () => void;
}

function createInterleaveCoordinator(
  hasAudio: boolean,
  startTime: number,
): InterleaveCoordinator {
  let videoHead = startTime;
  let audioHead = hasAudio ? startTime : Number.POSITIVE_INFINITY;
  let released = false;
  let waiters: Array<() => void> = [];

  const notify = () => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };

  return {
    head: () => Math.min(videoHead, audioHead),
    update: (kind, timestamp) => {
      if (kind === "video") videoHead = Math.max(videoHead, timestamp);
      else audioHead = Math.max(audioHead, timestamp);
      notify();
    },
    markDone: (kind) => {
      if (kind === "video") videoHead = Number.POSITIVE_INFINITY;
      else audioHead = Number.POSITIVE_INFINITY;
      notify();
    },
    waitForOther: async (kind, timestamp) => {
      for (;;) {
        if (released) return;
        const other = kind === "video" ? audioHead : videoHead;
        if (timestamp - other <= INTERLEAVE_WINDOW_SECONDS) return;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
    release: () => {
      released = true;
      notify();
    },
  };
}

interface PumpState {
  gen: number;
  startTime: number;
  sync: InterleaveCoordinator;
  finished: boolean;
  ioCancelled: boolean;
  output: Output | null;
  reader: ReadableStreamDefaultReader<Uint8Array> | null;
}

function isQuotaExceededError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

function waitForMediaSourceOpen(mediaSource: MediaSource): Promise<void> {
  if (mediaSource.readyState === "open") return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      mediaSource.removeEventListener("sourceopen", handleOpen);
      mediaSource.removeEventListener("sourceclose", handleClose);
    };
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(new Error("MediaSource closed before opening"));
    };

    mediaSource.addEventListener("sourceopen", handleOpen, { once: true });
    mediaSource.addEventListener("sourceclose", handleClose, { once: true });
  });
}

export async function attachClientRemuxPlayback(
  options: ClientRemuxPlaybackOptions,
): Promise<ClientRemuxPlaybackHandle> {
  const { video, mediaUrl, onFatalError } = options;

  if (typeof MediaSource === "undefined") {
    throw new Error("MediaSource is not available in this browser");
  }

  let destroyed = false;
  let generation = 0;
  let pump: PumpState | null = null;
  let input: Input | null = null;
  let sourceBuffer: SourceBuffer | null = null;
  let forwardBufferSeconds = FORWARD_BUFFER_SECONDS;
  let lastEvictionCheckAt = 0;

  // Wakes anything waiting on playback progress (forward-buffer gate, quota
  // retries). Poked by timeupdate/seeking/play and on teardown.
  let wakeWaiters: Array<() => void> = [];
  const wake = () => {
    const pending = wakeWaiters;
    wakeWaiters = [];
    for (const resolve of pending) resolve();
  };
  const waitForWake = () =>
    new Promise<void>((resolve) => wakeWaiters.push(resolve));

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  const videoListeners: Array<[keyof HTMLVideoElementEventMap, () => void]> =
    [];

  const isStale = (gen: number) => destroyed || gen !== generation;

  function destroyInternal(): void {
    if (destroyed) return;
    destroyed = true;
    generation += 1;
    if (pump) cancelPumpIO(pump);
    wake();
    for (const [type, handler] of videoListeners) {
      video.removeEventListener(type, handler);
    }
    input?.dispose();
    if (sourceBuffer && mediaSource.readyState === "open") {
      try {
        sourceBuffer.abort();
      } catch {
        // The MediaSource may be mid-teardown; abort is best-effort.
      }
    }
    URL.revokeObjectURL(objectUrl);
    // Only unhook the media element if we still own it. During fallback the
    // caller may have already pointed it at a Plex stream URL.
    if (video.src === objectUrl) {
      video.removeAttribute("src");
      video.load();
    }
  }

  function fail(error: unknown): void {
    if (destroyed) return;
    destroyInternal();
    onFatalError(error);
  }

  function cancelPumpIO(state: PumpState): void {
    if (state.ioCancelled) return;
    state.ioCancelled = true;
    state.sync.release();
    wake();
    void state.output?.cancel().catch(() => undefined);
    void state.reader?.cancel().catch(() => undefined);
  }

  /* ── SourceBuffer operation queue ─────────────────────────
     appendBuffer/remove must never run concurrently; every operation is
     serialized through this chain and resolved on updateend. */

  let sourceBufferOpChain: Promise<void> = Promise.resolve();

  function enqueueSourceBufferOp(op: () => void): Promise<void> {
    const run = sourceBufferOpChain.then(() => runSourceBufferOp(op));
    sourceBufferOpChain = run.catch(() => undefined);
    return run;
  }

  function runSourceBufferOp(op: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const buffer = sourceBuffer;
      if (
        destroyed ||
        !buffer ||
        (mediaSource.readyState !== "open" &&
          mediaSource.readyState !== "ended")
      ) {
        resolve();
        return;
      }

      const cleanup = () => {
        buffer.removeEventListener("updateend", handleUpdateEnd);
        buffer.removeEventListener("error", handleError);
      };
      const handleUpdateEnd = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error("SourceBuffer operation failed"));
      };

      buffer.addEventListener("updateend", handleUpdateEnd);
      buffer.addEventListener("error", handleError);

      try {
        op();
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (!buffer.updating) {
        // Synchronous no-op (nothing scheduled); don't wait for updateend.
        cleanup();
        resolve();
      }
    });
  }

  /* ── Buffer management ────────────────────────────────────── */

  async function evictPlayedRanges(
    gen: number,
    aggressive = false,
  ): Promise<boolean> {
    const buffer = sourceBuffer;
    if (!buffer || isStale(gen)) return false;

    const ranges = bufferedToRanges(buffer.buffered);
    const removeEnd = computeEvictionEnd({
      currentTime: video.currentTime,
      keepBehindSeconds: aggressive ? 3 : BACK_BUFFER_SECONDS,
      earliestBufferedStart: ranges[0]?.start ?? null,
    });
    if (removeEnd === null) return false;

    await enqueueSourceBufferOp(() => buffer.remove(0, removeEnd));
    return !isStale(gen);
  }

  async function appendChunk(
    state: PumpState,
    chunk: Uint8Array,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      if (isStale(state.gen) || state.ioCancelled) return;
      try {
        await enqueueSourceBufferOp(() => {
          sourceBuffer?.appendBuffer(chunk);
        });
        return;
      } catch (error) {
        if (isStale(state.gen) || state.ioCancelled) return;
        if (!isQuotaExceededError(error) || attempt >= MAX_QUOTA_RETRIES) {
          throw error;
        }
        // Quota pressure: shrink the forward window, drop played media, and
        // wait for the playhead to advance before retrying.
        forwardBufferSeconds = Math.max(
          MIN_FORWARD_BUFFER_SECONDS,
          forwardBufferSeconds / 2,
        );
        const evicted = await evictPlayedRanges(state.gen, true);
        if (!evicted) await waitForWake();
      }
    }
  }

  async function waitForForwardWindow(state: PumpState): Promise<void> {
    for (;;) {
      if (isStale(state.gen) || state.ioCancelled) return;
      // Until the caller's resume-seek lands, currentTime can still be 0
      // while the pump feeds from a resume offset; gate against whichever
      // playhead is further along so the initial segments always flow.
      const playhead = Math.max(video.currentTime, state.startTime);
      if (state.sync.head() - playhead <= forwardBufferSeconds) return;
      await waitForWake();
    }
  }

  /* ── Setup: probe the file and resolve the pipeline ───────── */

  video.src = objectUrl;
  video.load();

  let mediabunny: MediabunnyModule;
  let videoTrack: InputVideoTrack;
  let audioPlan: AudioPipelinePlan;
  let videoDecoderConfig: VideoDecoderConfig;
  let info: ClientRemuxPipelineInfo;
  let duration: number | null = null;

  try {
    await waitForMediaSourceOpen(mediaSource);
    if (destroyed) throw new Error("Client remux playback destroyed");

    await registerCodecExtensions();
    mediabunny = await loadMediabunny();

    input = new mediabunny.Input({
      formats: mediabunny.ALL_FORMATS,
      source: new mediabunny.UrlSource(mediaUrl, {
        maxCacheSize: URL_SOURCE_CACHE_BYTES,
      }),
    });

    const [primaryVideoTrack, audioTrack] = await Promise.all([
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
    ]);
    if (!primaryVideoTrack) {
      throw new Error("No video track found in media");
    }
    videoTrack = primaryVideoTrack;

    const videoCodec = await videoTrack.getCodec();
    if (videoCodec !== "avc") {
      throw new Error(`Unsupported video codec for packet copy: ${videoCodec}`);
    }

    const rotation = await videoTrack.getRotation();
    if (rotation !== 0) {
      // Mediabunny's MP4 muxer cannot carry rotation metadata, so a copied
      // stream would render sideways. Let Plex transcode these.
      throw new Error(`Rotated video (${rotation}°) requires a transcode`);
    }

    const videoCodecString = await videoTrack.getCodecParameterString();
    if (!videoCodecString) {
      throw new Error("Missing video codec parameter string");
    }
    const decoderConfig = await videoTrack.getDecoderConfig();
    if (!decoderConfig) {
      throw new Error("Missing video decoder configuration");
    }
    videoDecoderConfig = decoderConfig;

    let audioCodecString: string | null = null;
    if (!audioTrack) {
      audioPlan = { kind: "none" };
    } else {
      const audioCodec = await audioTrack.getCodec();
      if (!audioCodec) {
        throw new Error("Unknown audio codec");
      }
      const nativeCodecString = await audioTrack.getCodecParameterString();
      const canCopy =
        MSE_COPYABLE_AUDIO_CODECS.has(audioCodec) &&
        !!nativeCodecString &&
        MediaSource.isTypeSupported(`audio/mp4; codecs="${nativeCodecString}"`);

      if (canCopy) {
        audioPlan = {
          kind: "copy",
          codec: audioCodec,
          track: audioTrack,
          decoderConfig: await audioTrack.getDecoderConfig(),
        };
        audioCodecString = nativeCodecString;
      } else {
        if (!(await audioTrack.canDecode())) {
          throw new Error(`Cannot decode audio codec: ${audioCodec}`);
        }
        const numberOfChannels = Math.min(
          await audioTrack.getNumberOfChannels(),
          2,
        );
        if (!(await mediabunny.canEncodeAudio("aac", { numberOfChannels }))) {
          throw new Error("No AAC encoder available for audio transcode");
        }
        audioPlan = { kind: "transcode", track: audioTrack, numberOfChannels };
        audioCodecString = "mp4a.40.2";
      }
    }

    const mimeType = audioCodecString
      ? `video/mp4; codecs="${videoCodecString}, ${audioCodecString}"`
      : `video/mp4; codecs="${videoCodecString}"`;
    if (!MediaSource.isTypeSupported(mimeType)) {
      throw new Error(`MediaSource does not support ${mimeType}`);
    }

    duration =
      (await input.getDurationFromMetadata()) ??
      (await input.computeDuration());
    if (destroyed) throw new Error("Client remux playback destroyed");

    if (
      mediaSource.readyState === "open" &&
      duration !== null &&
      Number.isFinite(duration) &&
      duration > 0
    ) {
      mediaSource.duration = duration;
    }

    sourceBuffer = mediaSource.addSourceBuffer(mimeType);
    sourceBuffer.mode = "segments";

    info = {
      mimeType,
      videoCodecString,
      audioMode: audioPlan.kind,
      duration,
    };
  } catch (error) {
    destroyInternal();
    throw error;
  }

  /* ── Pump: feed packets/samples into the SourceBuffer ─────── */

  async function feedVideoPackets(
    state: PumpState,
    source: EncodedVideoPacketSource,
  ): Promise<void> {
    const sink = new mediabunny.EncodedPacketSink(videoTrack);
    const startPacket =
      (await sink.getKeyPacket(state.startTime, { verifyKeyPackets: true })) ??
      (await sink.getFirstKeyPacket({ verifyKeyPackets: true }));
    if (!startPacket) {
      throw new Error("No video key packet found");
    }

    let isFirst = true;
    for await (const packet of sink.packets(startPacket)) {
      if (state.ioCancelled || isStale(state.gen)) return;
      await source.add(
        packet,
        isFirst ? { decoderConfig: videoDecoderConfig } : undefined,
      );
      isFirst = false;
      state.sync.update("video", packet.timestamp);
      await state.sync.waitForOther("video", packet.timestamp);
    }
    state.sync.markDone("video");
  }

  async function feedAudioPacketCopy(
    state: PumpState,
    source: EncodedAudioPacketSource,
    track: InputAudioTrack,
    decoderConfig: AudioDecoderConfig | null,
  ): Promise<void> {
    const sink = new mediabunny.EncodedPacketSink(track);
    const startPacket =
      (await sink.getPacket(state.startTime)) ?? (await sink.getFirstPacket());
    if (!startPacket) {
      state.sync.markDone("audio");
      return;
    }

    let isFirst = true;
    for await (const packet of sink.packets(startPacket)) {
      if (state.ioCancelled || isStale(state.gen)) return;
      await source.add(
        packet,
        isFirst && decoderConfig ? { decoderConfig } : undefined,
      );
      isFirst = false;
      state.sync.update("audio", packet.timestamp);
      await state.sync.waitForOther("audio", packet.timestamp);
    }
    state.sync.markDone("audio");
  }

  async function feedAudioTranscode(
    state: PumpState,
    source: AudioSampleSource,
    track: InputAudioTrack,
  ): Promise<void> {
    const sink = new mediabunny.AudioSampleSink(track);
    for await (const sample of sink.samples(state.startTime)) {
      if (state.ioCancelled || isStale(state.gen)) {
        sample.close();
        return;
      }
      await source.add(sample);
      const timestamp = sample.timestamp;
      sample.close();
      state.sync.update("audio", timestamp);
      await state.sync.waitForOther("audio", timestamp);
    }
    state.sync.markDone("audio");
  }

  async function consumeOutput(state: PumpState): Promise<void> {
    const reader = state.reader;
    if (!reader) return;

    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value || isStale(state.gen) || state.ioCancelled) return;
      await waitForForwardWindow(state);
      if (isStale(state.gen) || state.ioCancelled) return;
      await appendChunk(state, value);
    }
  }

  async function runPump(state: PumpState): Promise<void> {
    const { readable, writable } = new TransformStream<
      Uint8Array,
      Uint8Array
    >();
    const output = new mediabunny.Output({
      format: new mediabunny.Mp4OutputFormat({
        fastStart: "fragmented",
        minimumFragmentDuration: 1,
      }),
      target: new mediabunny.AppendOnlyStreamTarget(writable),
    });
    state.output = output;

    const videoSource = new mediabunny.EncodedVideoPacketSource("avc");
    output.addVideoTrack(videoSource);

    let audioFeeder: (() => Promise<void>) | null = null;
    switch (audioPlan.kind) {
      case "none":
        break;
      case "copy": {
        const plan = audioPlan;
        const source = new mediabunny.EncodedAudioPacketSource(plan.codec);
        output.addAudioTrack(source);
        audioFeeder = () =>
          feedAudioPacketCopy(state, source, plan.track, plan.decoderConfig);
        break;
      }
      case "transcode": {
        const plan = audioPlan;
        const source = new mediabunny.AudioSampleSource({
          codec: "aac",
          bitrate: AAC_TRANSCODE_BITRATE,
          transform: { numberOfChannels: plan.numberOfChannels },
        });
        output.addAudioTrack(source);
        audioFeeder = () => feedAudioTranscode(state, source, plan.track);
        break;
      }
      default: {
        const exhaustive: never = audioPlan;
        throw new Error(`Unhandled audio plan: ${JSON.stringify(exhaustive)}`);
      }
    }

    await output.start();
    if (isStale(state.gen) || state.ioCancelled) {
      cancelPumpIO(state);
      return;
    }

    state.reader = readable.getReader();

    // Any failing task cancels the pump's IO so its siblings unblock instead
    // of deadlocking on backpressure; only the first real error is kept.
    const errors: unknown[] = [];
    const capture = async (task: () => Promise<void>) => {
      try {
        await task();
      } catch (error) {
        if (!state.ioCancelled && !isStale(state.gen)) {
          errors.push(error);
        }
        cancelPumpIO(state);
      }
    };

    const feedersDone = Promise.all([
      capture(() => feedVideoPackets(state, videoSource)),
      ...(audioFeeder ? [capture(audioFeeder)] : []),
    ]);
    const finalizeDone = capture(async () => {
      await feedersDone;
      if (errors.length > 0 || state.ioCancelled || isStale(state.gen)) return;
      await output.finalize();
    });

    await Promise.all([
      feedersDone,
      finalizeDone,
      capture(() => consumeOutput(state)),
    ]);

    if (errors.length > 0 && !isStale(state.gen)) {
      throw errors[0];
    }
    if (isStale(state.gen) || state.ioCancelled) return;

    state.finished = true;
    // Flush any queued SourceBuffer work, then signal end-of-stream so the
    // element can fire `ended` at the tail of the media.
    await enqueueSourceBufferOp(() => undefined);
    if (
      !isStale(state.gen) &&
      mediaSource.readyState === "open" &&
      sourceBuffer &&
      !sourceBuffer.updating
    ) {
      mediaSource.endOfStream();
    }
  }

  function startPump(fromTime: number): void {
    const gen = ++generation;
    const state: PumpState = {
      gen,
      startTime: clampPumpStartTime(fromTime, duration),
      sync: createInterleaveCoordinator(
        audioPlan.kind !== "none",
        clampPumpStartTime(fromTime, duration),
      ),
      finished: false,
      ioCancelled: false,
      output: null,
      reader: null,
    };
    pump = state;
    wake();

    void runPump(state).catch((error) => {
      if (isStale(state.gen)) return;
      fail(error);
    });
  }

  function restartPump(fromTime: number): void {
    const previous = pump;
    if (previous) cancelPumpIO(previous);
    if (sourceBuffer && mediaSource.readyState === "open") {
      try {
        // Reset the segment parser: the previous pump may have been cut off
        // mid-fragment.
        sourceBuffer.abort();
      } catch {
        // Best-effort; a closed MediaSource aborts implicitly.
      }
    }
    startPump(fromTime);
  }

  /* ── Video element integration ────────────────────────────── */

  function handleSeeking(): void {
    wake();
    if (destroyed || !sourceBuffer) return;

    const target = video.currentTime;
    const activePump =
      pump?.gen === generation && !pump.ioCancelled ? pump : null;
    const restart = shouldRestartPumpForSeek({
      target,
      buffered: bufferedToRanges(sourceBuffer.buffered),
      pump: activePump
        ? {
            startTime: activePump.startTime,
            feederHead: activePump.sync.head(),
            finished: activePump.finished,
          }
        : null,
    });
    if (restart) {
      restartPump(target);
    }
  }

  function handleTimeUpdate(): void {
    wake();
    const now = Date.now();
    if (now - lastEvictionCheckAt < EVICTION_CHECK_INTERVAL_MS) return;
    lastEvictionCheckAt = now;
    void evictPlayedRanges(generation).catch(() => undefined);
  }

  const addVideoListener = (
    type: keyof HTMLVideoElementEventMap,
    handler: () => void,
  ) => {
    video.addEventListener(type, handler);
    videoListeners.push([type, handler]);
  };

  addVideoListener("seeking", handleSeeking);
  addVideoListener("timeupdate", handleTimeUpdate);
  addVideoListener("play", wake);

  startPump(options.startTime);

  return {
    info,
    destroy: destroyInternal,
  };
}
