import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Locator, type Page } from "@playwright/test";
import { z } from "zod";

const PLEX_PIN_API = "https://plex.tv/api/v2/pins";
const PLEX_AUTH_URL = "https://app.plex.tv/auth";
const PLEX_AUTH_FORWARD_URL = "https://app.plex.tv/desktop";
const PLEX_PRODUCT = "Multiplex Watch Together Harness";
const PLEX_CLIENT_IDENTIFIER = "multiplex-watch-together-harness";
const POLL_INTERVAL_MS = 1_000;
const MAX_AUTHORIZATION_MS = 5 * 60_000;
const WORKSPACE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_TOKEN_FILE = path.join(WORKSPACE_ROOT, ".watch-together-harness", "tokens.json");

const environmentSchema = z
  .object({
    WATCH_TOGETHER_ACCOUNT_A_EMAIL: z.string().optional(),
    WATCH_TOGETHER_ACCOUNT_A_PASSWORD: z.string().optional(),
    WATCH_TOGETHER_ACCOUNT_B_EMAIL: z.string().optional(),
    WATCH_TOGETHER_ACCOUNT_B_PASSWORD: z.string().optional(),
    MULTIPLEX_ACCOUNT_EMAIL: z.string().optional(),
    MULTIPLEX_ACCOUNT_PASSWORD: z.string().optional(),
    MUTLIPLEX_ACCOUNT_EMAIL_2: z.string().optional(),
    MULTIPLEX_ACCOUNT_PASSWORD_2: z.string().optional(),
    WATCH_TOGETHER_HARNESS_TOKEN_FILE: z.string().optional(),
    WATCH_TOGETHER_HARNESS_HEADED: z.string().optional(),
    PLAYWRIGHT_CHANNEL: z.string().optional(),
  })
  .passthrough();

const credentialsSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

const plexPinSchema = z.object({
  id: z.number().int().positive(),
  code: z.string().min(1),
  expiresIn: z.number().positive().optional(),
  authToken: z.string().min(1).nullable().optional(),
});

export const tokenFileSchema = z.object({
  accountA: z.object({ token: z.string().min(1) }),
  accountB: z.object({ token: z.string().min(1) }),
});

type Environment = z.infer<typeof environmentSchema>;
type Credentials = z.infer<typeof credentialsSchema>;
type PlexPin = z.infer<typeof plexPinSchema>;
type TokenFile = z.infer<typeof tokenFileSchema>;
type AccountLabel = "account A" | "account B";

type PinPollResult =
  | { readonly _tag: "Pending" }
  | { readonly _tag: "Authorized"; readonly token: string };

class SafeBootstrapError extends Error {}

function resolveCredentialPair(
  email: string | undefined,
  password: string | undefined,
  expectedVariables: string,
): Credentials {
  const parsed = credentialsSchema.safeParse({ email, password });
  if (!parsed.success) {
    throw new SafeBootstrapError(`Missing Plex credentials. Set ${expectedVariables}.`);
  }
  return parsed.data;
}

export function resolveAccountCredentials(environment: Environment): {
  readonly accountA: Credentials;
  readonly accountB: Credentials;
} {
  return {
    accountA: resolveCredentialPair(
      environment.WATCH_TOGETHER_ACCOUNT_A_EMAIL ?? environment.MULTIPLEX_ACCOUNT_EMAIL,
      environment.WATCH_TOGETHER_ACCOUNT_A_PASSWORD ?? environment.MULTIPLEX_ACCOUNT_PASSWORD,
      "WATCH_TOGETHER_ACCOUNT_A_EMAIL and WATCH_TOGETHER_ACCOUNT_A_PASSWORD (or MULTIPLEX_ACCOUNT_EMAIL and MULTIPLEX_ACCOUNT_PASSWORD)",
    ),
    accountB: resolveCredentialPair(
      environment.WATCH_TOGETHER_ACCOUNT_B_EMAIL ?? environment.MUTLIPLEX_ACCOUNT_EMAIL_2,
      environment.WATCH_TOGETHER_ACCOUNT_B_PASSWORD ?? environment.MULTIPLEX_ACCOUNT_PASSWORD_2,
      "WATCH_TOGETHER_ACCOUNT_B_EMAIL and WATCH_TOGETHER_ACCOUNT_B_PASSWORD (or MUTLIPLEX_ACCOUNT_EMAIL_2 and MULTIPLEX_ACCOUNT_PASSWORD_2)",
    ),
  };
}

export function resolveTokenFilePath(environment: Environment): string {
  const override = environment.WATCH_TOGETHER_HARNESS_TOKEN_FILE?.trim();
  if (!override) return DEFAULT_TOKEN_FILE;
  return path.isAbsolute(override) ? override : path.resolve(WORKSPACE_ROOT, override);
}

async function parsePinResponse(response: Response): Promise<PlexPin> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SafeBootstrapError(
      "Plex returned an unreadable PIN response. No token file was changed.",
    );
  }

  const parsed = plexPinSchema.safeParse(body);
  if (!parsed.success) {
    throw new SafeBootstrapError(
      "Plex returned an unexpected PIN response. No token file was changed.",
    );
  }
  return parsed.data;
}

async function createPlexPin(): Promise<PlexPin> {
  const url = new URL(PLEX_PIN_API);
  url.searchParams.set("strong", "true");
  url.searchParams.set("X-Plex-Product", PLEX_PRODUCT);
  url.searchParams.set("X-Plex-Client-Identifier", PLEX_CLIENT_IDENTIFIER);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new SafeBootstrapError(
      "Could not reach Plex to create an authorization PIN. Check the network and retry.",
    );
  }
  if (!response.ok) {
    throw new SafeBootstrapError(
      `Plex rejected PIN creation with HTTP ${response.status}. No token file was changed.`,
    );
  }
  return await parsePinResponse(response);
}

function buildPlexAuthorizationUrl(pin: PlexPin): string {
  const parameters = new URLSearchParams({
    forwardUrl: PLEX_AUTH_FORWARD_URL,
    clientID: PLEX_CLIENT_IDENTIFIER,
    code: pin.code,
    "context[device][product]": PLEX_PRODUCT,
  });
  return `${PLEX_AUTH_URL}#!?${parameters.toString()}`;
}

async function pollPlexPin(pin: PlexPin): Promise<PinPollResult> {
  const url = new URL(`${PLEX_PIN_API}/${pin.id}`);
  url.searchParams.set("code", pin.code);
  url.searchParams.set("X-Plex-Client-Identifier", PLEX_CLIENT_IDENTIFIER);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
    });
  } catch {
    return { _tag: "Pending" };
  }
  if (!response.ok) {
    throw new SafeBootstrapError(
      `Plex PIN polling failed with HTTP ${response.status}. Restart authentication.`,
    );
  }

  const current = await parsePinResponse(response);
  return current.authToken ? { _tag: "Authorized", token: current.authToken } : { _tag: "Pending" };
}

async function acknowledgePlexInterstitial(page: Page): Promise<void> {
  const labels = [/authorize/i, /allow/i, /^continue$/i, /got it/i, /^ok$/i];
  const form = page.frameLocator('iframe[src*="auth-form"]');

  for (const name of labels) {
    const candidates: Locator[] = [
      page.getByRole("button", { name }).first(),
      form.getByRole("button", { name }).first(),
    ];
    for (const button of candidates) {
      if (!(await button.isVisible().catch(() => false))) continue;
      await button.click().catch(() => undefined);
      return;
    }
  }
}

async function submitPlexLogin(page: Page, pin: PlexPin, credentials: Credentials): Promise<void> {
  await page.goto(buildPlexAuthorizationUrl(pin), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForURL(/app\.plex\.tv\/auth/, { timeout: 60_000 });

  const form = page.frameLocator('iframe[src*="auth-form"]');
  const emailField = form.locator("#email");
  if (!(await emailField.isVisible().catch(() => false))) {
    await form.getByTestId("signIn--email").click({ timeout: 30_000 });
  }
  await emailField.waitFor({ state: "visible", timeout: 30_000 });
  await emailField.fill(credentials.email);
  await form.locator("#password").fill(credentials.password);
  await form.getByTestId("signIn--submit").click({ timeout: 30_000 });
}

async function waitForPlexToken(page: Page, pin: PlexPin): Promise<string> {
  const plexLifetimeMs = (pin.expiresIn ?? MAX_AUTHORIZATION_MS / 1_000) * 1_000;
  const deadline = Date.now() + Math.min(plexLifetimeMs, MAX_AUTHORIZATION_MS);

  while (Date.now() < deadline) {
    const result = await pollPlexPin(pin);
    if (result._tag === "Authorized") return result.token;
    await acknowledgePlexInterstitial(page);
    await page.waitForTimeout(POLL_INTERVAL_MS);
  }

  throw new SafeBootstrapError(
    "Plex authorization timed out. No token file was changed. Rerun with WATCH_TOGETHER_HARNESS_HEADED=1 if Plex requires additional confirmation.",
  );
}

async function authenticateAccount(
  browser: Browser,
  label: AccountLabel,
  credentials: Credentials,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const pin = await createPlexPin();
    const page = await context.newPage();
    await submitPlexLogin(page, pin, credentials);
    return await waitForPlexToken(page, pin);
  } catch (error) {
    if (error instanceof SafeBootstrapError) throw error;
    throw new SafeBootstrapError(
      `Plex authorization failed for ${label}. No token file was changed. Rerun with WATCH_TOGETHER_HARNESS_HEADED=1 to inspect the login flow.`,
    );
  } finally {
    await context.close().catch(() => undefined);
  }
}

export async function writeTokenFile(tokenFilePath: string, value: TokenFile): Promise<void> {
  const validated = tokenFileSchema.parse(value);
  const directory = path.dirname(tokenFilePath);
  const temporaryPath = `${tokenFilePath}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });

  try {
    await writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, tokenFilePath);
    await chmod(tokenFilePath, 0o600);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const environment = environmentSchema.parse(process.env);
  const credentials = resolveAccountCredentials(environment);
  const tokenFilePath = resolveTokenFilePath(environment);
  const requestedChannel = environment.PLAYWRIGHT_CHANNEL?.trim();
  const channel =
    !requestedChannel || requestedChannel === "chromium" ? undefined : requestedChannel;

  let browser: Browser;
  try {
    browser = await chromium.launch({
      channel,
      headless: environment.WATCH_TOGETHER_HARNESS_HEADED !== "1",
    });
  } catch {
    throw new SafeBootstrapError(
      "Could not launch a browser for Plex authentication. Install Playwright Chromium or set PLAYWRIGHT_CHANNEL to an installed browser channel.",
    );
  }

  try {
    console.log("Authorizing account A with Plex...");
    const accountAToken = await authenticateAccount(browser, "account A", credentials.accountA);
    console.log("Authorized account A.");

    console.log("Authorizing account B with Plex...");
    const accountBToken = await authenticateAccount(browser, "account B", credentials.accountB);
    console.log("Authorized account B.");

    await writeTokenFile(tokenFilePath, {
      accountA: { token: accountAToken },
      accountB: { token: accountBToken },
    });
    console.log(`Saved the private harness token file at ${tokenFilePath}.`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message =
      error instanceof SafeBootstrapError
        ? error.message
        : "Watch Together harness authentication failed unexpectedly. No credentials or tokens were printed.";
    console.error(message);
    process.exitCode = 1;
  }
}
