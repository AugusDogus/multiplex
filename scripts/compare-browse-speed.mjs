/**
 * Headed Chrome side-by-side: Multiplex vs official Plex web.
 * Primary metric: navigationStart → Continue Watching posters visible.
 *
 * Usage (from repo root, with bun + playwright from apps/web):
 *   bun scripts/compare-browse-speed.mjs
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const MULTIPLEX_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const PLEX_URL = "https://app.plex.tv/desktop/#!/";
const EMAIL = process.env.MULTIPLEX_ACCOUNT_EMAIL;
const PASSWORD = process.env.MULTIPLEX_ACCOUNT_PASSWORD;
const OUT_DIR = "/opt/cursor/artifacts/browse-compare";

if (!EMAIL || !PASSWORD) {
  throw new Error("Set MULTIPLEX_ACCOUNT_EMAIL and MULTIPLEX_ACCOUNT_PASSWORD");
}

async function loginMultiplex(page) {
  await page.goto(`${MULTIPLEX_URL}/login`, { waitUntil: "domcontentloaded" });
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
      const iframeBtn = form.getByRole("button", { name: label });
      if (await iframeBtn.count()) {
        try {
          await iframeBtn.first().click({ timeout: 1000 });
        } catch {
          /* optional */
        }
      }
    }
    const url = page.url();
    if (!url.includes("plex.tv") && !url.includes("/login")) break;
    await page.waitForTimeout(500);
  }
  await page.waitForURL((u) => !u.href.includes("plex.tv") && !u.pathname.startsWith("/login"), {
    timeout: 90_000,
  });
  await page.getByText("Continue Watching", { exact: false }).first().waitFor({
    timeout: 60_000,
  });
}

async function measureMultiplexHome(page, label) {
  const start = Date.now();
  await page.reload({ waitUntil: "commit" });

  // Section heading exists
  await page.getByText("Continue Watching", { exact: false }).first().waitFor({
    state: "visible",
    timeout: 60_000,
  });
  const headingMs = Date.now() - start;

  // At least one poster image in the main content has non-zero naturalWidth
  await page.waitForFunction(
    () => {
      const heading = [...document.querySelectorAll("h2,h3,[class*='title']")].find((el) =>
        /continue watching/i.test(el.textContent ?? ""),
      );
      if (!heading) return false;
      const root = heading.closest("section") ?? heading.parentElement?.parentElement;
      if (!root) return false;
      const imgs = [...root.querySelectorAll("img")];
      return imgs.some((img) => img.complete && img.naturalWidth > 20);
    },
    null,
    { timeout: 60_000 },
  );
  const postersMs = Date.now() - start;

  const nav = await page.evaluate(() => {
    const e = performance.getEntriesByType("navigation")[0];
    return e
      ? {
          domContentLoaded: Math.round(e.domContentLoadedEventEnd),
          loadEvent: Math.round(e.loadEventEnd),
          responseStart: Math.round(e.responseStart),
          responseEnd: Math.round(e.responseEnd),
          transferSize: e.transferSize,
        }
      : null;
  });

  const trpc = await page.evaluate(() => {
    return performance
      .getEntriesByType("resource")
      .filter((r) => r.name.includes("/api/trpc/"))
      .map((r) => ({
        name: r.name.split("/").pop()?.slice(0, 80),
        duration: Math.round(r.duration),
        start: Math.round(r.startTime),
        transferSize: r.transferSize,
      }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 12);
  });

  await page.screenshot({
    path: `${OUT_DIR}/multiplex-${label}.png`,
    fullPage: false,
  });

  return { headingMs, postersMs, nav, trpc, wallMs: Date.now() - start };
}

async function loginPlexWeb(page) {
  await page.goto(PLEX_URL, { waitUntil: "domcontentloaded" });
  // Already signed in?
  const signedIn = await page
    .getByText(/continue watching/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (signedIn) return;

  // Sign-in entry points vary
  const signIn = page.getByRole("button", { name: /sign in/i }).first();
  if (await signIn.isVisible().catch(() => false)) {
    await signIn.click();
  } else {
    await page.goto("https://app.plex.tv/auth/#?", {
      waitUntil: "domcontentloaded",
    });
  }

  await page.waitForTimeout(1500);
  const form = page.frameLocator('iframe[src*="auth-form"]');
  const emailBtn = form.getByTestId("signIn--email");
  if (await emailBtn.count()) {
    await emailBtn.click({ timeout: 30_000 });
  }
  await form.locator("#email").fill(EMAIL, { timeout: 30_000 });
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
    if (
      await page
        .getByText(/continue watching/i)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      break;
    }
    await page.waitForTimeout(500);
  }

  await page.goto(PLEX_URL, { waitUntil: "domcontentloaded" });
  await page
    .getByText(/continue watching/i)
    .first()
    .waitFor({ timeout: 90_000 });
}

async function measurePlexHome(page, label) {
  const start = Date.now();
  await page.reload({ waitUntil: "commit" });

  await page
    .getByText(/continue watching/i)
    .first()
    .waitFor({
      state: "visible",
      timeout: 90_000,
    });
  const headingMs = Date.now() - start;

  await page.waitForFunction(
    () => {
      const nodes = [...document.querySelectorAll("*")].filter((el) =>
        /^continue watching$/i.test((el.textContent ?? "").trim()),
      );
      for (const heading of nodes) {
        let root = heading.parentElement;
        for (let i = 0; i < 6 && root; i++) {
          const imgs = [...root.querySelectorAll("img")];
          if (imgs.some((img) => img.complete && img.naturalWidth > 20)) return true;
          root = root.parentElement;
        }
      }
      // Fallback: any poster-sized image on home
      return [...document.querySelectorAll("img")].some(
        (img) => img.complete && img.naturalWidth > 80 && img.naturalHeight > 80,
      );
    },
    null,
    { timeout: 90_000 },
  );
  const postersMs = Date.now() - start;

  const nav = await page.evaluate(() => {
    const e = performance.getEntriesByType("navigation")[0];
    return e
      ? {
          domContentLoaded: Math.round(e.domContentLoadedEventEnd),
          loadEvent: Math.round(e.loadEventEnd),
          responseStart: Math.round(e.responseStart),
          responseEnd: Math.round(e.responseEnd),
          transferSize: e.transferSize,
        }
      : null;
  });

  const xhr = await page.evaluate(() => {
    return performance
      .getEntriesByType("resource")
      .filter(
        (r) =>
          /continue|hubs|recentlyAdded|metadata|library/i.test(r.name) &&
          (r.initiatorType === "xmlhttprequest" ||
            r.initiatorType === "fetch" ||
            r.name.includes("/:/")),
      )
      .map((r) => ({
        name: r.name.replace(/^https?:\/\/[^/]+/, "").slice(0, 100),
        duration: Math.round(r.duration),
        start: Math.round(r.startTime),
        transferSize: r.transferSize,
      }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 15);
  });

  await page.screenshot({
    path: `${OUT_DIR}/plex-${label}.png`,
    fullPage: false,
  });

  return { headingMs, postersMs, nav, xhr, wallMs: Date.now() - start };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const report = {
    measuredAt: new Date().toISOString(),
    caveat:
      "Multiplex assets from localhost (near-zero RTT). Plex web assets from CDN. Primary metric is time-to-Continue-Watching-posters, not Network Finish.",
    multiplex: {},
    plexWeb: {},
  };

  console.log("Logging into Multiplex…");
  await loginMultiplex(page);
  // Settle
  await page.waitForTimeout(2000);

  console.log("Multiplex cold (cache disabled)…");
  await context.route("**/*", (route) => route.continue());
  await page.evaluate(async () => {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  });
  // CDP disable cache for cold
  const client = await context.newCDPSession(page);
  await client.send("Network.setCacheDisabled", { cacheDisabled: true });
  report.multiplex.cold = await measureMultiplexHome(page, "cold");
  console.log("Multiplex cold:", report.multiplex.cold);

  await client.send("Network.setCacheDisabled", { cacheDisabled: false });
  await page.waitForTimeout(1500);
  console.log("Multiplex warm…");
  report.multiplex.warm = await measureMultiplexHome(page, "warm");
  console.log("Multiplex warm:", report.multiplex.warm);

  console.log("Logging into Plex web…");
  const plexPage = await context.newPage();
  await loginPlexWeb(plexPage);
  await plexPage.waitForTimeout(2000);

  const plexClient = await context.newCDPSession(plexPage);
  await plexClient.send("Network.setCacheDisabled", { cacheDisabled: true });
  console.log("Plex web cold…");
  report.plexWeb.cold = await measurePlexHome(plexPage, "cold");
  console.log("Plex web cold:", report.plexWeb.cold);

  await plexClient.send("Network.setCacheDisabled", { cacheDisabled: false });
  await plexPage.waitForTimeout(1500);
  console.log("Plex web warm…");
  report.plexWeb.warm = await measurePlexHome(plexPage, "warm");
  console.log("Plex web warm:", report.plexWeb.warm);

  report.comparison = {
    coldPostersDeltaMs: report.multiplex.cold.postersMs - report.plexWeb.cold.postersMs,
    warmPostersDeltaMs: report.multiplex.warm.postersMs - report.plexWeb.warm.postersMs,
    coldWinner:
      report.multiplex.cold.postersMs < report.plexWeb.cold.postersMs
        ? "multiplex"
        : report.multiplex.cold.postersMs > report.plexWeb.cold.postersMs
          ? "plex"
          : "tie",
    warmWinner:
      report.multiplex.warm.postersMs < report.plexWeb.warm.postersMs
        ? "multiplex"
        : report.multiplex.warm.postersMs > report.plexWeb.warm.postersMs
          ? "plex"
          : "tie",
  };

  await writeFile(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2), "utf8");
  console.log("\n=== REPORT ===");
  console.log(JSON.stringify(report.comparison, null, 2));
  console.log(`Wrote ${OUT_DIR}/report.json`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
