/**
 * Headed Chrome: Multiplex vs official Plex soft-nav (library + details).
 * Primary metric: click → meaningful content visible (not Network Finish).
 *
 * Usage (repo root, Playwright from apps/web):
 *   bun scripts/compare-soft-nav-speed.mjs
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const MULTIPLEX_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const PLEX_URL = "https://app.plex.tv/desktop/#!/";
const EMAIL = process.env.MULTIPLEX_ACCOUNT_EMAIL;
const PASSWORD = process.env.MULTIPLEX_ACCOUNT_PASSWORD;
const OUT_DIR = "/opt/cursor/artifacts/browse-compare";
const RUNS = 3;

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
    }
    const url = page.url();
    if (!url.includes("plex.tv") && !url.includes("/login")) break;
    await page.waitForTimeout(500);
  }
  await page.waitForURL(
    (u) => !u.href.includes("plex.tv") && !u.pathname.startsWith("/login"),
    { timeout: 90_000 },
  );
  await page.getByText("Continue Watching", { exact: false }).first().waitFor({
    timeout: 90_000,
  });
}

async function openPlexYourMedia(page) {
  await page.goto(PLEX_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Multiplex OAuth does not always create a full app.plex.tv desktop session.
  // Sign in first when the chrome still shows Sign In.
  const signIn = page.getByRole("button", { name: /^sign in$/i }).first();
  if (await signIn.isVisible().catch(() => false)) {
    await signIn.click();
    await page.waitForTimeout(2000);
    const form = page.frameLocator('iframe[src*="auth-form"]');
    const emailBtn = form.getByTestId("signIn--email");
    if (await emailBtn.count()) {
      await emailBtn.click({ timeout: 15_000 }).catch(() => {});
    }
    if (await form.locator("#email").count()) {
      await form.locator("#email").fill(EMAIL, { timeout: 15_000 });
      await form.locator("#password").fill(PASSWORD);
      await form.getByTestId("signIn--submit").click();
    }
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      for (const label of [/authorize/i, /allow/i, /^continue$/i, /got it/i]) {
        const btn = page.getByRole("button", { name: label });
        if (await btn.count()) {
          try {
            await btn.first().click({ timeout: 1000 });
          } catch {
            /* optional */
          }
        }
      }
      // Signed-in chrome drops the Sign Up CTA.
      const stillSignedOut = await page
        .getByRole("button", { name: /^sign up$/i })
        .first()
        .isVisible()
        .catch(() => false);
      if (!stillSignedOut) break;
      await page.waitForTimeout(500);
    }
    await page.goto(PLEX_URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  }

  // Discover home is the default; library soft-nav must start from Your Media.
  const yourMedia = page.getByRole("link", { name: /your media/i }).or(
    page.getByText(/^Your Media$/i),
  );
  if (await yourMedia.first().isVisible().catch(() => false)) {
    await yourMedia.first().click();
    await page.waitForTimeout(2000);
  }

  const ready = await Promise.race([
    page
      .getByText(/continue watching/i)
      .first()
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => "cw"),
    page
      .getByText(/^Movies$/i)
      .first()
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => "lib"),
  ]).catch(() => null);

  if (!ready) {
    await page.screenshot({
      path: `${OUT_DIR}/plex-your-media-fail.png`,
      fullPage: false,
    });
    throw new Error("Plex Your Media did not show Continue Watching or Movies");
  }
}

async function waitForPosterImages(page, min = 1) {
  await page.waitForFunction(
    (need) => {
      const imgs = [...document.querySelectorAll("img")].filter(
        (img) => img.complete && img.naturalWidth > 40 && img.naturalHeight > 40,
      );
      return imgs.length >= need;
    },
    min,
    { timeout: 60_000 },
  );
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

async function measureMultiplexSoftNavOnce(page) {
  await page.goto(MULTIPLEX_URL, { waitUntil: "domcontentloaded" });
  await page.getByText("Continue Watching", { exact: false }).first().waitFor({
    timeout: 60_000,
  });
  await page.waitForTimeout(1000);

  const libraryLink = page
    .locator('a[href*="/media/"][href*="source="]')
    .first();
  await libraryLink.waitFor({ state: "visible", timeout: 30_000 });
  await libraryLink.hover();
  await page.waitForTimeout(1200);

  const libStart = Date.now();
  await libraryLink.click();
  await page.waitForURL(/\/media\//, { timeout: 30_000 });
  await waitForPosterImages(page, 3);
  const libraryMs = Date.now() - libStart;

  const detailsLink = page
    .locator('a[href*="/item/"]')
    .filter({ has: page.locator("h3") })
    .first();
  await detailsLink.waitFor({ state: "visible", timeout: 30_000 });
  await detailsLink.hover();
  await detailsLink.focus();
  await page.waitForTimeout(1200);

  const detailsStart = Date.now();
  await detailsLink.click();
  await page.waitForURL(/\/item\//, { timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const hasHeroImg = [...document.querySelectorAll("img")].some(
        (img) => img.complete && img.naturalWidth > 200,
      );
      const hasPlay = !!document.querySelector(
        'button[aria-label*="Play"], a[aria-label*="Play"]',
      );
      const h1 = document.querySelector("h1");
      const hasTitle = !!h1 && (h1.textContent ?? "").trim().length > 0;
      return (hasTitle && hasHeroImg) || (hasTitle && hasPlay);
    },
    null,
    { timeout: 60_000 },
  );
  const detailsMs = Date.now() - detailsStart;
  return { libraryMs, detailsMs };
}

async function measurePlexSoftNavOnce(page) {
  // Return to Your Media home between runs.
  const home = page.getByText(/^Home$/i).first();
  if (await home.isVisible().catch(() => false)) {
    await home.click();
    await page.waitForTimeout(800);
  }
  const yourMedia = page.getByText(/^Your Media$/i).first();
  if (await yourMedia.isVisible().catch(() => false)) {
    await yourMedia.click();
    await page.waitForTimeout(1000);
  }

  const libraryCandidates = [
    page.getByRole("link", { name: /^movies$/i }),
    page.getByRole("button", { name: /^movies$/i }),
    page.getByText(/^movies$/i),
    page.getByRole("link", { name: /^tv shows$/i }),
    page.getByText(/^tv shows$/i),
  ];

  let libraryTarget = null;
  for (const cand of libraryCandidates) {
    if (await cand.first().isVisible().catch(() => false)) {
      libraryTarget = cand.first();
      break;
    }
  }
  if (!libraryTarget) {
    libraryTarget = page
      .locator("a, button")
      .filter({ hasText: /movies|tv shows/i })
      .first();
  }

  await libraryTarget.waitFor({ state: "visible", timeout: 30_000 });
  await libraryTarget.hover().catch(() => {});
  await page.waitForTimeout(1200);

  const libStart = Date.now();
  await libraryTarget.click();
  await page.waitForTimeout(100);
  await waitForPosterImages(page, 3);
  const libraryMs = Date.now() - libStart;

  const posterLink = page
    .locator("a")
    .filter({ has: page.locator("img") })
    .first();
  await posterLink.hover().catch(() => {});
  await page.waitForTimeout(1200);

  const detailsStart = Date.now();
  await posterLink.click();
  await page.waitForFunction(
    () => {
      const h1 = document.querySelector(
        "h1, [class*='Title'], [data-testid*='title']",
      );
      const titleOk =
        !!h1 &&
        (h1.textContent ?? "").trim().length > 1 &&
        (h1.textContent ?? "").trim().length < 200;
      const bigImg = [...document.querySelectorAll("img")].some(
        (img) => img.complete && img.naturalWidth > 300,
      );
      return titleOk && bigImg;
    },
    null,
    { timeout: 60_000 },
  );
  const detailsMs = Date.now() - detailsStart;
  return { libraryMs, detailsMs };
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

  const report = {
    measuredAt: new Date().toISOString(),
    caveat:
      "Soft-nav after 1200ms hover prefetch; median of runs after 1 warm-up. Multiplex localhost; Plex CDN. Plex measured from Your Media (not Discover).",
    runs: RUNS,
    multiplex: { runs: [], libraryMs: null, detailsMs: null },
    plexWeb: { runs: [], libraryMs: null, detailsMs: null },
  };

  const muxPage = await context.newPage();
  console.log("Logging into Multiplex…");
  await loginMultiplex(muxPage);
  console.log("Warm-up Multiplex soft-nav…");
  await measureMultiplexSoftNavOnce(muxPage);
  for (let i = 0; i < RUNS; i++) {
    const run = await measureMultiplexSoftNavOnce(muxPage);
    report.multiplex.runs.push(run);
    console.log(`Multiplex run ${i + 1}:`, run);
  }
  report.multiplex.libraryMs = median(
    report.multiplex.runs.map((r) => r.libraryMs),
  );
  report.multiplex.detailsMs = median(
    report.multiplex.runs.map((r) => r.detailsMs),
  );
  await muxPage.screenshot({
    path: `${OUT_DIR}/multiplex-soft-details.png`,
    fullPage: false,
  });

  const plexPage = await context.newPage();
  console.log("Opening Plex Your Media…");
  await openPlexYourMedia(plexPage);
  await plexPage.screenshot({
    path: `${OUT_DIR}/plex-your-media.png`,
    fullPage: false,
  });
  console.log("Warm-up Plex soft-nav…");
  await measurePlexSoftNavOnce(plexPage);
  for (let i = 0; i < RUNS; i++) {
    const run = await measurePlexSoftNavOnce(plexPage);
    report.plexWeb.runs.push(run);
    console.log(`Plex run ${i + 1}:`, run);
  }
  report.plexWeb.libraryMs = median(report.plexWeb.runs.map((r) => r.libraryMs));
  report.plexWeb.detailsMs = median(report.plexWeb.runs.map((r) => r.detailsMs));
  await plexPage.screenshot({
    path: `${OUT_DIR}/plex-soft-details.png`,
    fullPage: false,
  });

  report.comparison = {
    libraryDeltaMs: report.multiplex.libraryMs - report.plexWeb.libraryMs,
    detailsDeltaMs: report.multiplex.detailsMs - report.plexWeb.detailsMs,
    libraryWinner:
      report.multiplex.libraryMs < report.plexWeb.libraryMs
        ? "multiplex"
        : report.multiplex.libraryMs > report.plexWeb.libraryMs
          ? "plex"
          : "tie",
    detailsWinner:
      report.multiplex.detailsMs < report.plexWeb.detailsMs
        ? "multiplex"
        : report.multiplex.detailsMs > report.plexWeb.detailsMs
          ? "plex"
          : "tie",
  };

  await writeFile(
    `${OUT_DIR}/soft-nav-report.json`,
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log("\n=== SOFT-NAV REPORT ===");
  console.log(JSON.stringify(report, null, 2));
  await browser.close();

  if (
    report.comparison.libraryWinner !== "multiplex" ||
    report.comparison.detailsWinner !== "multiplex"
  ) {
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
