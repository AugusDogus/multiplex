import {
  PlaybackIntent,
  SyncplaySessionController,
  type SyncplayParticipantState,
  type SyncplayRemoteAction,
  type SyncplaySeekResult,
} from "@multiplex/plex-query";
import { z } from "zod";

import {
  harnessBootstrapSchema,
  harnessNextRoomSchema,
  harnessTranscodeSessionSchema,
  type HarnessMedia,
  type HarnessRoom,
  type HarnessStreamMode,
  type HarnessViewer,
} from "./contract";

const assertions = requireElement("assertions", HTMLPreElement);
const timeline = requireElement("timeline", HTMLPreElement);
const roomStatus = requireElement("room-status", HTMLDivElement);
const players = requireElement("players", HTMLElement);
const playerTemplate = requireElement("player-template", HTMLTemplateElement);
const playBothButton = requireElement("play-both", HTMLButtonElement);
const pauseHostButton = requireElement("pause-host", HTMLButtonElement);
const playHostButton = requireElement("play-host", HTMLButtonElement);
const seekHalfButton = requireElement("seek-half", HTMLButtonElement);
const rapidSeekHostButton = requireElement("rapid-seek-host", HTMLButtonElement);
const seekNearEndButton = requireElement("seek-near-end", HTMLButtonElement);
const disconnectGuestButton = requireElement("disconnect-guest", HTMLButtonElement);
const nextEpisodeButton = requireElement("next-episode", HTMLButtonElement);

const eventLines: string[] = [];
let activePlayers: [HarnessPlayer, HarnessPlayer] | null = null;
let nextEpisode: HarnessMedia | null = null;
let guestConnected = true;
let episodeTransitionPending = false;

function requireElement<T extends Element>(id: string, constructor: { new (): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`Harness element #${id} is missing or has the wrong type.`);
  }
  return element;
}

function requireDescendant<T extends Element>(
  parent: ParentNode,
  selector: string,
  constructor: { new (): T },
): T {
  const element = parent.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Harness element ${selector} is missing or has the wrong type.`);
  }
  return element;
}

function logEvent(message: string): void {
  eventLines.push(`${new Date().toISOString()}  ${message}`);
  if (eventLines.length > 500) eventLines.splice(0, eventLines.length - 500);
  timeline.textContent = eventLines.join("\n");
  timeline.scrollTop = timeline.scrollHeight;
}

async function readJson<Output>(
  response: Response,
  schema: z.ZodType<Output>,
): Promise<Output> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(body);
    const message = parsed.success
      ? parsed.data.error
      : `Harness request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return schema.parse(body);
}

interface HarnessTranscodeStream {
  readonly _tag: "Transcode";
  readonly url: string;
  readonly transcodeSessionId: string;
}

interface HarnessDirectPlayStream {
  readonly _tag: "DirectPlay";
  readonly url: string;
}

type HarnessStream = HarnessTranscodeStream | HarnessDirectPlayStream;

function applyPlexIdentity(url: URL, viewer: HarnessViewer): void {
  url.searchParams.set("X-Plex-Token", viewer.token);
  url.searchParams.set("X-Plex-Platform", "Chrome");
  url.searchParams.set("X-Plex-Platform-Version", "1.0");
  url.searchParams.set("X-Plex-Product", "Multiplex Harness");
  url.searchParams.set("X-Plex-Version", "1.0.0");
  url.searchParams.set("X-Plex-Client-Identifier", viewer.user.deviceIdentifier);
  url.searchParams.set("X-Plex-Device", "Chrome");
  url.searchParams.set("X-Plex-Device-Name", "Multiplex Harness");
}

function buildStream(
  viewer: HarnessViewer,
  offsetSeconds: number,
  playbackSessionId: string,
  streamMode: HarnessStreamMode,
): HarnessStream {
  const base = viewer.serverUrl.replace(/\/$/, "");
  if (streamMode === "direct-play") {
    const url = new URL(`${base}${viewer.item.partKey}`);
    applyPlexIdentity(url, viewer);
    url.searchParams.set("X-Plex-Protocol", "1.0");
    url.searchParams.set("X-Plex-Session-Identifier", playbackSessionId);
    return { _tag: "DirectPlay", url: url.toString() };
  }

  const url = new URL(`${base}/video/:/transcode/universal/start.mp4`);
  const offset = Math.max(0, Math.floor(offsetSeconds));
  const transcodeSessionId = `${playbackSessionId}-${offset}`;

  url.searchParams.set("path", viewer.item.key);
  url.searchParams.set("mediaIndex", "0");
  url.searchParams.set("partIndex", "0");
  url.searchParams.set("protocol", "http");
  url.searchParams.set("fastSeek", "1");
  url.searchParams.set("directPlay", "0");
  url.searchParams.set("directStream", "1");
  url.searchParams.set("directStreamAudio", "0");
  url.searchParams.set("audioBoost", "100");
  url.searchParams.set("subtitleSize", "100");
  url.searchParams.set("location", "lan");
  url.searchParams.set("subtitles", "none");
  url.searchParams.set("session", transcodeSessionId);
  if (offset > 0) url.searchParams.set("offset", String(offset));
  url.searchParams.set(
    "X-Plex-Client-Profile-Extra",
    [
      "add-direct-play(type=videoProfile&container=mp4&videoCodec=h264&audioCodec=aac)",
      "add-direct-play(type=videoProfile&container=mp4&videoCodec=h264&audioCodec=mp3)",
      "add-transcode-target(type=videoProfile&context=streaming&protocol=http&container=mp4&videoCodec=h264&audioCodec=aac)",
      "add-direct-stream-audio-codec(type=videoProfile&audioCodec=aac)",
      "add-direct-stream-audio-codec(type=videoProfile&audioCodec=mp3)",
    ].join("+"),
  );
  applyPlexIdentity(url, viewer);
  url.searchParams.set("X-Plex-Session-Identifier", playbackSessionId);
  return { _tag: "Transcode", url: url.toString(), transcodeSessionId };
}

class HarnessPlayer {
  private viewer: HarnessViewer;
  private room: HarnessRoom;
  private readonly streamMode: HarnessStreamMode;
  private readonly video: HTMLVideoElement;
  private readonly stateLabel: HTMLElement;
  private readonly titleLabel: HTMLElement;
  private readonly timelineValue: HTMLElement;
  private readonly readyValue: HTMLElement;
  private readonly streamValue: HTMLElement;
  private controller: SyncplaySessionController | null = null;
  private playbackSessionId = crypto.randomUUID();
  private streamOffsetSeconds = 0;
  private targetTimelineSeconds = 0;
  private activeTranscodeSessionId: string | null = null;
  private isLoading = true;
  private mediaError: string | null = null;
  private resumeAfterLoad = false;
  private sourceGeneration = 0;
  private hasConnected = false;
  private readonly playbackIntent = PlaybackIntent.make();

  constructor(viewer: HarnessViewer, room: HarnessRoom, streamMode: HarnessStreamMode) {
    this.viewer = viewer;
    this.room = room;
    this.streamMode = streamMode;
    const card = playerTemplate.content.firstElementChild?.cloneNode(true);
    if (!(card instanceof HTMLElement)) {
      throw new Error("Player template must contain an HTML element.");
    }
    this.video = requireDescendant(card, "video", HTMLVideoElement);
    this.stateLabel = requireDescendant(card, ".viewer-state", HTMLElement);
    this.titleLabel = requireDescendant(card, ".viewer-title", HTMLElement);
    this.timelineValue = requireDescendant(card, ".timeline-value", HTMLElement);
    this.readyValue = requireDescendant(card, ".ready-value", HTMLElement);
    this.streamValue = requireDescendant(card, ".stream-value", HTMLElement);
    requireDescendant(card, ".viewer-label", HTMLElement).textContent = viewer.label;
    this.bindMediaEvents();
    this.render();
    players.append(card);
  }

  get label(): string {
    return this.viewer.label;
  }

  get item(): HarnessMedia {
    return this.viewer.item;
  }

  get positionSeconds(): number {
    // Replacing a media `src` does not synchronously reset `currentTime`.
    // While the offset stream loads, the element can still expose the prior
    // stream's time. Keep the requested full-timeline target authoritative
    // until the new stream is ready so we never report offset + stale time.
    return this.isLoading
      ? this.targetTimelineSeconds
      : this.streamOffsetSeconds + (this.video.currentTime || 0);
  }

  get durationSeconds(): number {
    return this.viewer.item.durationMs / 1_000;
  }

  get paused(): boolean {
    return this.video.paused;
  }

  connect(reloadMedia: boolean, shouldResume = false): void {
    const isReconnect = this.hasConnected;
    this.hasConnected = true;
    this.controller?.disconnect();
    this.controller = new SyncplaySessionController({
      room: this.room,
      user: this.viewer.user,
      player: {
        getState: () => ({
          isPlaying: !this.video.paused,
          currentTime: this.positionSeconds,
          duration: this.durationSeconds,
          canPlay:
            this.video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA &&
            !this.isLoading &&
            this.mediaError === null,
          isLoading: this.isLoading,
          error: this.mediaError,
        }),
        play: () => this.play(),
        pause: () => this.pause(),
        seek: (seconds) => this.seek(seconds, false),
      },
      onParticipant: (participant) => this.onParticipant(participant),
      onRemoteAction: (action) => this.onRemoteAction(action),
      onClose: () => logEvent(`${this.label}: Syncplay disconnected`),
      onError: (error) =>
        logEvent(
          `${this.label}: Syncplay error: ${error instanceof Error ? error.message : error.type}`,
        ),
      onFatalError: (error) => logEvent(`${this.label}: fatal Syncplay error: ${error.message}`),
      remoteStartupGraceMs: isReconnect ? 0 : undefined,
      seekAheadThresholdSeconds: isReconnect ? 0.25 : undefined,
      seekBehindThresholdSeconds: isReconnect ? -0.25 : undefined,
    });
    this.controller.connect();
    if (reloadMedia) this.loadStream(shouldResume);
    logEvent(`${this.label}: connected to room ${this.room.id}`);
  }

  disconnect(): void {
    this.controller?.disconnect();
    this.controller = null;
    this.stateLabel.textContent = "disconnected";
  }

  async play(): Promise<boolean> {
    const revision = this.playbackIntent.beginPlay();
    this.resumeAfterLoad = true;
    try {
      await this.video.play();
      if (!this.playbackIntent.isCurrent(revision)) {
        if (!this.playbackIntent.shouldPlay()) this.video.pause();
        return false;
      }
      return true;
    } catch (error) {
      logEvent(
        `${this.label}: play rejected: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  pause(): void {
    this.playbackIntent.pause();
    this.resumeAfterLoad = false;
    this.video.pause();
  }

  seek(targetSeconds: number, localAction = true): SyncplaySeekResult {
    if (!Number.isFinite(targetSeconds) || this.durationSeconds <= 0) {
      return "none";
    }
    const target = Math.min(Math.max(0, targetSeconds), Math.max(0, this.durationSeconds - 0.5));
    if (this.streamMode === "direct-play") {
      this.video.currentTime = target;
      this.targetTimelineSeconds = target;
      if (localAction) this.controller?.handleLocalSeeked(target);
      logEvent(
        `${this.label}: ${localAction ? "local" : "remote"} direct seek to ${target.toFixed(2)}s`,
      );
      return "direct";
    }
    this.resumeAfterLoad = !this.video.paused || this.resumeAfterLoad;
    this.streamOffsetSeconds = target;
    this.targetTimelineSeconds = target;
    this.loadStream(this.resumeAfterLoad);
    if (localAction) this.controller?.handleLocalSeeked(target);
    logEvent(`${this.label}: ${localAction ? "local" : "remote"} seek to ${target.toFixed(2)}s`);
    return "reload";
  }

  switchRoom(viewer: HarnessViewer, room: HarnessRoom): void {
    this.controller?.disconnect();
    this.viewer = viewer;
    this.room = room;
    this.playbackSessionId = crypto.randomUUID();
    this.streamOffsetSeconds = 0;
    this.targetTimelineSeconds = 0;
    this.resumeAfterLoad = true;
    this.mediaError = null;
    this.connect(true, true);
    logEvent(`${this.label}: switched to ${viewer.item.title} in ${room.id}`);
  }

  async stopStream(): Promise<void> {
    const sessionId = this.activeTranscodeSessionId;
    if (!sessionId) return;
    this.activeTranscodeSessionId = null;
    await this.stopTranscodeSession(sessionId);
  }

  private async stopTranscodeSession(sessionId: string): Promise<void> {
    const body = JSON.stringify(
      harnessTranscodeSessionSchema.parse({
        label: this.viewer.label,
        sessionId,
      }),
    );
    await fetch("/api/transcode/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }

  private bindMediaEvents(): void {
    this.video.addEventListener("loadstart", () => {
      this.isLoading = true;
      this.controller?.setReady(false);
      this.render();
    });
    const ready = (): void => {
      this.isLoading = false;
      this.targetTimelineSeconds = this.streamOffsetSeconds + (this.video.currentTime || 0);
      this.mediaError = null;
      this.controller?.setReady(true);
      this.render();
      if (this.resumeAfterLoad && this.video.paused) void this.play();
    };
    this.video.addEventListener("canplay", ready);
    this.video.addEventListener("loadeddata", ready);
    this.video.addEventListener("play", () => {
      this.resumeAfterLoad = true;
      this.controller?.handleLocalPlaybackChange(false);
      logEvent(`${this.label}: media play`);
      this.render();
    });
    this.video.addEventListener("pause", () => {
      if (!this.isLoading) this.resumeAfterLoad = false;
      this.controller?.handleLocalPlaybackChange(true);
      logEvent(`${this.label}: media pause${this.isLoading ? " during load" : ""}`);
      this.render();
    });
    this.video.addEventListener("timeupdate", () => this.render());
    this.video.addEventListener("waiting", () => {
      this.stateLabel.textContent = "buffering";
    });
    this.video.addEventListener("ended", () => {
      logEvent(`${this.label}: media ended`);
      if (this.label === "Account A") void advanceToNextEpisode("host media ended");
    });
    this.video.addEventListener("error", () => {
      const code = this.video.error?.code ?? 0;
      this.mediaError = `media error ${code}`;
      this.isLoading = false;
      this.controller?.setReady(false);
      logEvent(`${this.label}: ${this.mediaError}`);
      this.render();
    });
  }

  private loadStream(shouldResume: boolean): void {
    const generation = ++this.sourceGeneration;
    this.resumeAfterLoad = shouldResume;
    this.isLoading = true;
    this.mediaError = null;
    this.render();
    void (async () => {
      // Plex servers commonly enforce a small transcode limit. Do not race a
      // replacement stream against teardown of the stream it replaces.
      await this.stopStream();
      if (generation !== this.sourceGeneration) return;

      const stream = buildStream(
        this.viewer,
        this.streamOffsetSeconds,
        this.playbackSessionId,
        this.streamMode,
      );
      if (stream._tag === "Transcode") {
        const registration = await fetch("/api/transcode/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            label: this.viewer.label,
            sessionId: stream.transcodeSessionId,
          }),
        });
        if (!registration.ok) {
          this.mediaError = `transcode registration HTTP ${registration.status}`;
          this.isLoading = false;
          this.render();
          return;
        }
        if (generation !== this.sourceGeneration) {
          await this.stopTranscodeSession(stream.transcodeSessionId);
          return;
        }
        this.activeTranscodeSessionId = stream.transcodeSessionId;
      }
      if (generation !== this.sourceGeneration) return;
      this.video.src = stream.url;
      this.video.load();
    })();
  }

  private onParticipant(participant: SyncplayParticipantState): void {
    logEvent(
      `${this.label}: participant ${participant.user.deviceIdentifier} present=${String(participant.isPresent)} ready=${String(participant.isReady)}`,
    );
  }

  private onRemoteAction(action: SyncplayRemoteAction): void {
    const author = action.user?.deviceIdentifier ?? "unknown";
    logEvent(
      `${this.label}: remote ${action.type} by ${author} at ${action.positionSeconds.toFixed(2)}s`,
    );
  }

  private render(): void {
    this.titleLabel.textContent = this.viewer.item.title;
    this.timelineValue.textContent = `${this.positionSeconds.toFixed(2)}s / ${this.durationSeconds.toFixed(2)}s`;
    this.readyValue.textContent = !this.isLoading && this.mediaError === null ? "yes" : "no";
    this.streamValue.textContent =
      this.streamMode === "direct-play"
        ? "direct play"
        : `offset ${Math.floor(this.streamOffsetSeconds)}s`;
    this.stateLabel.textContent = this.mediaError
      ? this.mediaError
      : this.isLoading
        ? "loading"
        : this.video.paused
          ? "paused"
          : "playing";
  }
}

function renderAssertions(): void {
  const pair = activePlayers;
  if (!pair) return;
  const [host, guest] = pair;
  const delta = Math.abs(host.positionSeconds - guest.positionSeconds);
  const checks = [
    `${host.item.ratingKey === guest.item.ratingKey ? "PASS" : "FAIL"} same media (${host.item.ratingKey} / ${guest.item.ratingKey})`,
    `${delta <= 2 ? "PASS" : "FAIL"} timeline delta ${delta.toFixed(3)}s`,
    `${host.paused === guest.paused ? "PASS" : "FAIL"} pause parity (host=${host.paused}, guest=${guest.paused})`,
    `${guestConnected ? "INFO" : "INFO"} guest transport ${guestConnected ? "connected" : "disconnected"}`,
  ];
  assertions.textContent = checks.join("\n");
}

async function start(): Promise<void> {
  const response = await fetch("/api/bootstrap", { cache: "no-store" });
  const bootstrap = await readJson(response, harnessBootstrapSchema);
  roomStatus.textContent = `Room ${bootstrap.room.id}`;
  nextEpisode = bootstrap.nextEpisode;
  nextEpisodeButton.disabled = nextEpisode === null;
  nextEpisodeButton.textContent = nextEpisode ? `Next: ${nextEpisode.title}` : "No next episode";

  const host = new HarnessPlayer(bootstrap.viewers[0], bootstrap.room, bootstrap.streamMode);
  const guest = new HarnessPlayer(bootstrap.viewers[1], bootstrap.room, bootstrap.streamMode);
  activePlayers = [host, guest];
  host.connect(true);
  guest.connect(true);
  logEvent(`Harness ready in room ${bootstrap.room.id}`);
}

playBothButton.addEventListener("click", () => {
  const pair = activePlayers;
  if (!pair) return;
  void Promise.all(pair.map((player) => player.play()));
});

pauseHostButton.addEventListener("click", () => {
  activePlayers?.[0].pause();
});

playHostButton.addEventListener("click", () => {
  const host = activePlayers?.[0];
  if (host) void host.play();
});

seekHalfButton.addEventListener("click", () => {
  const host = activePlayers?.[0];
  if (host) host.seek(host.durationSeconds * 0.5);
});

rapidSeekHostButton.addEventListener("click", () => {
  void (async () => {
    const host = activePlayers?.[0];
    if (!host) return;
    rapidSeekHostButton.disabled = true;
    for (const fraction of [0.1, 0.8, 0.3, 0.9, 0.2, 0.7, 0.4, 0.6]) {
      host.seek(host.durationSeconds * fraction);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 125));
    }
    rapidSeekHostButton.disabled = false;
    logEvent("Account A: rapid seek sequence completed at 60%");
  })();
});

seekNearEndButton.addEventListener("click", () => {
  const host = activePlayers?.[0];
  if (host) host.seek(host.durationSeconds - 0.75);
});

disconnectGuestButton.addEventListener("click", () => {
  const guest = activePlayers?.[1];
  if (!guest) return;
  if (guestConnected) {
    guest.disconnect();
    guestConnected = false;
    disconnectGuestButton.textContent = "Reconnect guest";
  } else {
    guest.connect(false);
    guestConnected = true;
    disconnectGuestButton.textContent = "Disconnect guest";
  }
});

async function advanceToNextEpisode(reason: string): Promise<void> {
  if (episodeTransitionPending || !nextEpisode) return;
  episodeTransitionPending = true;
  try {
    nextEpisodeButton.disabled = true;
    const response = await fetch("/api/next-room", { method: "POST" });
    const next = await readJson(response, harnessNextRoomSchema);
    const pair = activePlayers;
    if (!pair) return;
    pair[0].switchRoom(next.viewers[0], next.room);
    pair[1].switchRoom(next.viewers[1], next.room);
    roomStatus.textContent = `Room ${next.room.id}`;
    nextEpisode = next.nextEpisode;
    nextEpisodeButton.textContent = nextEpisode ? `Next: ${nextEpisode.title}` : "No next episode";
    nextEpisodeButton.disabled = nextEpisode === null;
    logEvent(`Both viewers advanced because ${reason}`);
  } catch (error) {
    nextEpisodeButton.disabled = false;
    logEvent(`Next episode failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    episodeTransitionPending = false;
  }
}

nextEpisodeButton.addEventListener("click", () => {
  void advanceToNextEpisode("next episode control was activated");
});

window.addEventListener("beforeunload", () => {
  activePlayers?.forEach((player) => void player.stopStream());
});

setInterval(renderAssertions, 500);
start().catch((error) => {
  roomStatus.textContent = "Harness failed";
  logEvent(error instanceof Error ? error.message : String(error));
});
