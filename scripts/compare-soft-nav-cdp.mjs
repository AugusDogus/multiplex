/**
 * Soft-nav bakeoff against the already-signed-in desktop Chrome (CDP :9222).
 * Measures Multiplex (localhost:3000) vs Plex Your Media / Movies.
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const MULTIPLEX_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = "/opt/cursor/artifacts/browse-compare";
const RUNS = 3;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

async function waitForPosterImages(page, min = 3) {
  await page.waitForFunction(
    (need) =>
      [...document.querySelectorAll("img")].filter(
        (img) => img.complete && img.naturalWidth > 40 && img.naturalHeight > 40,
      ).length >= need,
    min,
    { timeout: 60_000 },
  );
}

async function ensureMultiplexHome(page) {
  await page.goto(MULTIPLEX_URL, { waitUntil: "domcontentloaded" });
  if (page.url().includes("/login")) {
    throw new Error("Multiplex not signed in on this Chrome profile");
  }
  await page.getByText("Continue Watching", { exact: false }).first().waitFor({
    timeout: 60_000,
  });
  await page.waitForTimeout(800);
}

async function measureMultiplex(page) {
  await ensureMultiplexHome(page);
  // Prefer Movies over first library (Anime) for a fairer compare with Plex Movies.
  const movies = page
    .locator('a[href*="/media/"][href*="source="]')
    .filter({ hasText: /^Movies$/i })
    .first();
  const libraryLink = (await movies.count())
    ? movies
    : page.locator('a[href*="/media/"][href*="source="]').first();
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
      const h1 = document.querySelector("h1");
      const hasTitle = !!h1 && (h1.textContent ?? "").trim().length > 0;
      const hasHero = [...document.querySelectorAll("img")].some(
        (img) => img.complete && img.naturalWidth > 200,
      );
      const hasPlay = !!document.querySelector(
        'button[aria-label*="Play"], a[aria-label*="Play"]',
      );
      return hasTitle && (hasHero || hasPlay);
    },
    null,
    { timeout: 60_000 },
  );
  const detailsMs = Date.now() - detailsStart;
  return { libraryMs, detailsMs };
}

async function ensurePlexYourMedia(page) {
  await page.goto("https://app.plex.tv/desktop/#!/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1500);
  const yourMedia = page.getByText(/^Your Media$/i).first();
  if (await yourMedia.isVisible().catch(() => false)) {
    await yourMedia.click();
    await page.waitForTimeout(1500);
  }
  // Wait for a library source in the sidebar / page.
  await page
    .getByText(/^Movies$/i)
    .first()
    .waitFor({ state: "visible", timeout: 60_000 });
}

async function measurePlex(page) {
  await ensurePlexYourMedia(page);
  const movies = page.getByText(/^Movies$/i).first();
  await movies.hover().catch(() => {});
  await page.waitForTimeout(1200);

  const libStart = Date.now();
  await movies.click();
  await waitForPosterImages(page, 3);
  const libraryMs = Date.now() - libStart;

  // Click a poster card (large image in main content).
  const poster = page
    .locator('[class*="Poster"] a, a[class*="poster"], a')
    .filter({ has: page.locator("img") })
    .first();
  // Prefer an img click if anchors are weird.
  const img = page.locator("main img, [role='main'] img, img").first();
  const target = (await poster.count()) ? poster : img;
  await target.hover().catch(() => {});
  await page.waitForTimeout(1200);

  const detailsStart = Date.now();
  await target.click({ force: true });
  await page.waitForFunction(
    () => {
      const text = document.body?.innerText ?? "";
      const hasPlay = /play$/im.test(text) || !!document.querySelector(
        'button, a',
      );
      const bigImg = [...document.querySelectorAll("img")].some(
        (i) => i.complete && i.naturalWidth > 250,
      );
      // Details pages usually show year or duration near the title.
      const meta = /\b(19|20)\d{2}\b|\d+h\s*\d*m|\d+min/i.test(text);
      return bigImg && meta && hasPlay;
    },
    null,
    { timeout: 60_000 },
  );
  const detailsMs = Date.now() - detailsStart;
  return { libraryMs, detailsMs };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const context = browser.contexts()[0];
  if (!context) throw new Error("No CDP browser context");

  const report = {
    measuredAt: new Date().toISOString(),
    caveat:
      "Connected to desktop Chrome via CDP. Soft-nav after 1200ms hover. Median of 3 runs after warm-up. Movies library preferred.",
    multiplex: { runs: [] },
    plexWeb: { runs: [] },
  };

  const muxPage = await context.newPage();
  console.log("Warm-up Multiplex…");
  await measureMultiplex(muxPage);
  for (let i = 0; i < RUNS; i++) {
    const run = await measureMultiplex(muxPage);
    report.multiplex.runs.push(run);
    console.log(`Multiplex ${i + 1}:`, run);
  }
  report.multiplex.libraryMs = median(
    report.multiplex.runs.map((r) => r.libraryMs),
  );
  report.multiplex.detailsMs = median(
    report.multiplex.runs.map((r) => r.detailsMs),
  );
  await muxPage.screenshot({
    path: `${OUT_DIR}/cdp-multiplex-details.png`,
    fullPage: false,
  });
  await muxPage.close();

  const plexPage = await context.newPage();
  console.log("Warm-up Plex…");
  await measurePlex(plexPage);
  for (let i = 0; i < RUNS; i++) {
    const run = await measurePlex(plexPage);
    report.plexWeb.runs.push(run);
    console.log(`Plex ${i + 1}:`, run);
  }
  report.plexWeb.libraryMs = median(report.plexWeb.runs.map((r) => r.libraryMs));
  report.plexWeb.detailsMs = median(report.plexWeb.runs.map((r) => r.detailsMs));
  await plexPage.screenshot({
    path: `${OUT_DIR}/cdp-plex-details.png`,
    fullPage: false,
  });
  await plexPage.close();

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
    `${OUT_DIR}/soft-nav-cdp-report.json`,
    JSON.stringify(report, null, 2),
    "utf8",
  );
  console.log("\n=== CDP SOFT-NAV REPORT ===");
  console.log(JSON.stringify(report, null, 2));

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
