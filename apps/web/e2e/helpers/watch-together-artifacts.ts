import {
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { z } from "zod";

import { indexHarnessRecording } from "../../../watch-together-harness/e2e/index-recording-frames";

const MAX_DIAGNOSTIC_EVENTS = 5_000;
const MAX_FRAME_LENGTH = 20_000;
const MAX_RESPONSE_BODY_LENGTH = 4_000;
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY =
  /(?:authorization|auth[_-]?token|access[_-]?token|x-plex-token|password|cookie|secret|capability|pin)/i;

type ArtifactJsonValue =
  | boolean
  | number
  | string
  | null
  | ArtifactJsonValue[]
  | { readonly [key: string]: ArtifactJsonValue };

type DiagnosticValue = ArtifactJsonValue | undefined;

const artifactJsonValueSchema: z.ZodType<ArtifactJsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number(),
    z.string(),
    z.null(),
    z.array(artifactJsonValueSchema),
    z.record(artifactJsonValueSchema),
  ]),
);

interface DiagnosticEvent {
  readonly at: number;
  readonly kind: string;
  readonly [key: string]: DiagnosticValue;
}

interface DiagnosticInput {
  readonly kind: string;
  readonly [key: string]: DiagnosticValue;
}

interface InstrumentedContextOptions {
  readonly browser: Browser;
  readonly baseURL: string | undefined;
  readonly label: "host" | "guest";
  readonly storageState?: string;
  readonly permissions?: string[];
  readonly recordVideoDir?: string;
  readonly testInfo: TestInfo;
}

export interface InstrumentedContext {
  readonly context: BrowserContext;
  readonly closeAndAttach: () => Promise<void>;
}

function redactSensitivePairs(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s"',}]+/gi, `Bearer ${REDACTED}`)
    .replace(
      /\b(authorization|auth[_-]?token|access[_-]?token|x-plex-token|password|cookie|secret|capability|pin)(\s*[=:]\s*|["']\s*:\s*["'])([^\s&"',}]+)/gi,
      (_match, key: string, separator: string) =>
        `${key}${separator}${REDACTED}`,
    )
    .replace(/(\/watch-together\/guest\/)[^/?#\s"']+/gi, `$1${REDACTED}`);
}

export function sanitizeArtifactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const [key, parameterValue] of url.searchParams) {
      url.searchParams.set(
        key,
        SENSITIVE_KEY.test(key)
          ? REDACTED
          : redactSensitivePairs(parameterValue),
      );
    }
    url.pathname = url.pathname.replace(
      /(\/watch-together\/guest\/)[^/]+/i,
      `$1${REDACTED}`,
    );
    return redactSensitivePairs(url.toString());
  } catch {
    return redactSensitivePairs(value);
  }
}

function sanitizeJsonValue(
  value: ArtifactJsonValue,
  key?: string,
): ArtifactJsonValue {
  if (key && SENSITIVE_KEY.test(key)) return REDACTED;
  const text = z.string().safeParse(value);
  if (text.success) return sanitizeArtifactText(text.data);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry));
  }
  if (value === null || value === true || value === false) return value;
  const number = z.number().safeParse(value);
  if (number.success) return number.data;
  const object = z.record(artifactJsonValueSchema).safeParse(value);
  if (!object.success) return null;

  const result: Record<string, ArtifactJsonValue> = {};
  for (const [property, propertyValue] of Object.entries(object.data)) {
    result[property] = sanitizeJsonValue(propertyValue, property);
  }
  return result;
}

export function sanitizeArtifactText(value: string): string {
  const withSanitizedUrls = value.replace(/https?:\/\/[^\s"'<>]+/gi, (url) =>
    sanitizeArtifactUrl(url),
  );
  return redactSensitivePairs(withSanitizedUrls);
}

function sanitizeFrame(payload: string | Buffer): string {
  const text = Buffer.isBuffer(payload) ? payload.toString("utf8") : payload;
  let sanitized: string;
  try {
    const parsed = artifactJsonValueSchema.safeParse(JSON.parse(text));
    sanitized = parsed.success
      ? (JSON.stringify(sanitizeJsonValue(parsed.data)) ?? "null")
      : sanitizeArtifactText(text);
  } catch {
    sanitized = sanitizeArtifactText(text);
  }
  return sanitized.length > MAX_FRAME_LENGTH
    ? `${sanitized.slice(0, MAX_FRAME_LENGTH)}...[TRUNCATED]`
    : sanitized;
}

/**
 * Creates one manually managed Watch Together browser context with full video
 * and a redacted event journal. Playwright traces are intentionally disabled:
 * action metadata can serialize a media element's token-bearing `src` URL.
 */
export async function createInstrumentedContext(
  options: InstrumentedContextOptions,
): Promise<InstrumentedContext> {
  const videoDir =
    options.recordVideoDir ??
    options.testInfo.outputPath(`${options.label}-video`);
  const diagnosticsPath = options.testInfo.outputPath(
    `${options.label}-diagnostics.json`,
  );
  const diagnostics: DiagnosticEvent[] = [];
  let droppedEvents = 0;
  let closed = false;

  const record = (event: DiagnosticInput): void => {
    if (diagnostics.length >= MAX_DIAGNOSTIC_EVENTS) {
      droppedEvents += 1;
      return;
    }
    diagnostics.push({ at: Date.now(), ...event });
  };

  const context = await options.browser.newContext({
    baseURL: options.baseURL,
    storageState: options.storageState,
    permissions: options.permissions,
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });

  const pages: Page[] = [];
  const instrumentPage = (page: Page): void => {
    pages.push(page);
    page.on("console", (message) => {
      record({
        kind: "console",
        level: message.type(),
        text: sanitizeArtifactText(message.text()),
        location: {
          url: sanitizeArtifactUrl(message.location().url),
          lineNumber: message.location().lineNumber,
          columnNumber: message.location().columnNumber,
        },
      });
    });
    page.on("pageerror", (error) => {
      record({
        kind: "pageerror",
        message: sanitizeArtifactText(error.message),
        stack: error.stack ? sanitizeArtifactText(error.stack) : undefined,
      });
    });
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return;
      record({ kind: "navigation", url: sanitizeArtifactUrl(frame.url()) });
    });
    page.on("websocket", (socket) => {
      const url = sanitizeArtifactUrl(socket.url());
      record({ kind: "websocket-open", url });
      socket.on("framesent", (event) => {
        record({
          kind: "websocket-frame",
          direction: "sent",
          url,
          payload: sanitizeFrame(event.payload),
        });
      });
      socket.on("framereceived", (event) => {
        record({
          kind: "websocket-frame",
          direction: "received",
          url,
          payload: sanitizeFrame(event.payload),
        });
      });
      socket.on("socketerror", (error) => {
        record({
          kind: "websocket-error",
          url,
          error: sanitizeArtifactText(error),
        });
      });
      socket.on("close", () => record({ kind: "websocket-close", url }));
    });
  };

  context.on("page", instrumentPage);
  context.on("requestfailed", (request) => {
    record({
      kind: "request-failed",
      method: request.method(),
      url: sanitizeArtifactUrl(request.url()),
      error: sanitizeArtifactText(
        request.failure()?.errorText ?? "unknown failure",
      ),
    });
  });
  context.on("response", (response) => {
    if (response.status() < 400) return;
    record({
      kind: "response-error",
      method: response.request().method(),
      status: response.status(),
      url: sanitizeArtifactUrl(response.url()),
    });
    if (!response.url().includes("/video/:/transcode/universal/start")) return;

    void response.text().then(
      (body) => {
        const sanitized = sanitizeArtifactText(body);
        record({
          kind: "response-error-body",
          status: response.status(),
          url: sanitizeArtifactUrl(response.url()),
          body:
            sanitized.length > MAX_RESPONSE_BODY_LENGTH
              ? `${sanitized.slice(0, MAX_RESPONSE_BODY_LENGTH)}...[TRUNCATED]`
              : sanitized,
        });
      },
      (error) => {
        record({
          kind: "artifact-error",
          artifact: "response-error-body",
          error: sanitizeArtifactText(
            error instanceof Error
              ? error.message
              : "Response body capture failed",
          ),
        });
      },
    );
  });

  const closeAndAttach = async (): Promise<void> => {
    if (closed) return;
    closed = true;

    const videos = pages.flatMap((page) => {
      const video = page.video();
      return video ? [video] : [];
    });
    try {
      await context.close();
    } catch (error) {
      record({
        kind: "artifact-error",
        artifact: "context-close",
        error: sanitizeArtifactText(String(error)),
      });
    }

    for (const [index, video] of videos.entries()) {
      try {
        const videoPath = await video.path();
        const frameCount = await indexHarnessRecording(videoPath);
        record({
          kind: "artifact-index",
          artifact: `video-${index + 1}`,
          frameCount,
        });
        await options.testInfo.attach(`${options.label}-video-${index + 1}`, {
          path: videoPath,
          contentType: "video/webm",
        });
        await options.testInfo.attach(
          `${options.label}-video-${index + 1}-frames`,
          {
            path: `${videoPath}.frames.json`,
            contentType: "application/json",
          },
        );
      } catch (error) {
        record({
          kind: "artifact-error",
          artifact: `video-${index + 1}`,
          error: sanitizeArtifactText(String(error)),
        });
      }
    }

    await writeFile(
      diagnosticsPath,
      JSON.stringify(
        {
          label: options.label,
          droppedEvents,
          finalPages: pages.map((page) => sanitizeArtifactUrl(page.url())),
          events: diagnostics,
        },
        null,
        2,
      ),
      "utf8",
    );
    await options.testInfo.attach(`${options.label}-diagnostics`, {
      path: diagnosticsPath,
      contentType: "application/json",
    });
  };

  return { context, closeAndAttach };
}
