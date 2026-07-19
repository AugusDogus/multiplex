import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const OUT = "/opt/cursor/artifacts/browse-compare";
await mkdir(OUT, { recursive: true });
const EMAIL = process.env.MULTIPLEX_ACCOUNT_EMAIL;
const PASSWORD = process.env.MULTIPLEX_ACCOUNT_PASSWORD;
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();

await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /continue with plex/i }).click();
await page.waitForURL(/app\.plex\.tv\/auth/, { timeout: 60_000 });
const form = page.frameLocator('iframe[src*="auth-form"]');
await form.getByTestId("signIn--email").click({ timeout: 30_000 });
await form.locator("#email").fill(EMAIL);
await form.locator("#password").fill(PASSWORD);
await form.getByTestId("signIn--submit").click();
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
  for (const label of [/authorize/i, /allow/i, /^continue$/i, /got it/i, /^ok$/i]) {
    const btn = page.getByRole("button", { name: label });
    if (await btn.count()) {
      try {
        await btn.first().click({ timeout: 1000 });
      } catch {
        /* optional */
      }
    }
  }
  if (!page.url().includes("plex.tv") && !page.url().includes("/login")) break;
  await page.waitForTimeout(400);
}
await page.getByText("Continue Watching", { exact: false }).first().waitFor({
  timeout: 90_000,
});
console.log("Multiplex ok", page.url());

const plex = await context.newPage();
await plex.goto("https://app.plex.tv/desktop/#!/", {
  waitUntil: "domcontentloaded",
});
await plex.waitForTimeout(8000);
await plex.screenshot({ path: `${OUT}/plex-login-debug.png`, fullPage: false });
console.log("Plex URL", plex.url());
console.log("Title", await plex.title());
const bodyText = await plex.locator("body").innerText().catch(() => "");
console.log("Body snippet:", bodyText.slice(0, 1200).replace(/\n+/g, " | "));
const cookies = await context.cookies("https://app.plex.tv");
console.log(
  "plex.tv cookies",
  cookies.map((c) => c.name).slice(0, 30),
);
await browser.close();
