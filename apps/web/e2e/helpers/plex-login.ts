import { expect, type Page } from "@playwright/test";

export interface PlexCredentials {
  login: string;
  password: string;
}

/**
 * Reads a pair of credentials from the environment, throwing a clear error if
 * either is missing so the suite fails fast with an actionable message.
 */
export function readCredentials(
  loginVar: string,
  passwordVar: string,
): PlexCredentials {
  const login = process.env[loginVar];
  const password = process.env[passwordVar];
  if (!login || !password) {
    throw new Error(
      `Missing Plex credentials: set ${loginVar} and ${passwordVar} in the environment.`,
    );
  }
  return { login, password };
}

/**
 * Logs a fresh browser context into Multiplex via the real plex.tv OAuth flow.
 *
 * The app starts the PIN flow and forwards to app.plex.tv, where the user signs
 * in with email/password; plex.tv then forwards back and the app exchanges the
 * PIN for a session. We drive that third-party login UI defensively because its
 * exact steps (email-first vs. combined form, "Continue with email", device
 * security prompts) vary.
 */
export async function loginToMultiplex(
  page: Page,
  credentials: PlexCredentials,
): Promise<void> {
  await page.goto("/login");

  await page.getByRole("button", { name: /continue with plex/i }).click();

  // The app forwards to app.plex.tv, which renders its sign-in UI inside a
  // same-origin /auth-form/ iframe.
  await page.waitForURL(/app\.plex\.tv\/auth/, { timeout: 60_000 });
  const form = page.frameLocator('iframe[src*="auth-form"]');

  // The form opens on an SSO chooser; pick email/password sign-in, which
  // reveals the email + password fields together.
  await form.getByTestId("signIn--email").click({ timeout: 30_000 });

  const emailField = form.locator("#email");
  await expect(emailField).toBeVisible({ timeout: 30_000 });
  await emailField.fill(credentials.login);
  await form.locator("#password").fill(credentials.password);
  await form.getByTestId("signIn--submit").click();

  // Plex may show a "new device" security interstitial or an authorize/allow
  // screen; click through anything that looks like a confirmation.
  await acknowledgeInterstitials(page);

  // Success = forwarded back to the app and no longer on /login.
  await page.waitForURL(
    (url) =>
      !url.href.includes("plex.tv") && !url.pathname.startsWith("/login"),
    { timeout: 90_000 },
  );

  // The app finishes the PIN exchange and lands on the authenticated home.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 60_000,
  });
}

async function acknowledgeInterstitials(page: Page): Promise<void> {
  // Best-effort: click common confirmation buttons that can appear after login
  // (authorize the app, dismiss a new-device alert, etc.). They may live in the
  // top page or the auth-form iframe. Each is optional, so we just poll until
  // we've left plex.tv (success) or time out.
  const labels = [/authorize/i, /allow/i, /^continue$/i, /got it/i, /^ok$/i];
  const form = page.frameLocator('iframe[src*="auth-form"]');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!page.url().includes("plex.tv")) return;
    let clicked = false;
    for (const name of labels) {
      for (const button of [
        page.getByRole("button", { name }).first(),
        form.getByRole("button", { name }).first(),
      ]) {
        if (await button.isVisible().catch(() => false)) {
          await button.click().catch(() => undefined);
          clicked = true;
          break;
        }
      }
      if (clicked) break;
    }
    await page.waitForTimeout(1_000);
  }
}
