/**
 * Measure Plex soft-nav using a copied signed-in Chrome profile.
 * This profile opens directly into Your Media (Continue Watching + libraries).
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const OUT_DIR = "/opt/cursor/artifacts/browse-compare";
const PROFILE = "/tmp/plex-chrome-profile";
const RUNS = 3;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

async function waitPosters(page, min = 3) {
  await page.waitForFunction(
    (need) =>
      [...document.querySelectorAll("img")].filter(
        (img) => img.complete && img.naturalWidth > 40 && img.naturalHeight > 40,
      ).length >= need,
    min,
    { timeout: 60_000 },
  );
}

async function goHome(page) {
  await page.goto("https://app.plex.tv/desktop/#!/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(1500);
  // Sidebar Home under Your Media
  const home = page.getByText(/^Home$/i).first();
  if (await home.isVisible().catch(() => false)) {
    await home.click();
    await page.waitForTimeout(1000);
  }
  await page.getByText(/continue watching/i).first().waitFor({
    state: "visible",
    timeout: 60_000,
  });
  await page.getByText(/^Movies$/i).first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
}

async function measureOnce(page) {
  await goHome(page);

  const movies = page.getByText(/^Movies$/i).first();
  await movies.hover().catch(() => {});
  await page.waitForTimeout(1200);

  const libStart = Date.now();
  await movies.click();
  await waitPosters(page, 3);
  const libraryMs = Date.now() - libStart;

  // Prefer a poster-sized image in the content area.
  const img = page.locator("img").nth(4);
  await img.waitFor({ state: "visible", timeout: 30_000 });
  await img.hover().catch(() => {});
  await page.waitForTimeout(1200);

  const detailsStart = Date.now();
  await img.click({ force: true });
  await page.waitForFunction(
    () => {
      const bigImg = [...document.querySelectorAll("img")].some(
        (i) => i.complete && i.naturalWidth > 250,
      );
      const text = document.body?.innerText ?? "";
      return bigImg && /Play/i.test(text);
    },
    null,
    { timeout: 60_000 },
  );
  const detailsMs = Date.now() - detailsStart;
  return { libraryMs, detailsMs };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome",
    headless: false,
    args: ["--disable-dev-shm-usage", "--no-first-run"],
    viewport: { width: 1440, height: 900 },
  });
  const page = context.pages()[0] ?? (await context.newPage());

  await goHome(page);
  await page.screenshot({
    path: `${OUT_DIR}/plex-profile-home.png`,
    fullPage: false,
  });
  console.log("Warm-up…");
  await measureOnce(page);

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const run = await measureOnce(page);
    runs.push(run);
    console.log(`Plex run ${i + 1}:`, run);
  }

  const report = {
    measuredAt: new Date().toISOString(),
    caveat:
      "Plex via copied signed-in Chrome profile. Multiplex via next start production. Soft-nav after 1200ms hover; median of 3 runs after warm-up.",
    plexWeb: {
      runs,
      libraryMs: median(runs.map((r) => r.libraryMs)),
      detailsMs: median(runs.map((r) => r.detailsMs)),
    },
    multiplexProduction: {
      libraryMs: 83,
      detailsMs: 51,
      runs: [
        { libraryMs: 69, detailsMs: 49 },
        { libraryMs: 83, detailsMs: 51 },
        { libraryMs: 83, detailsMs: 51 },
      ],
    },
  };
  report.comparison = {
    libraryWinner:
      report.multiplexProduction.libraryMs < report.plexWeb.libraryMs
        ? "multiplex"
        : report.multiplexProduction.libraryMs > report.plexWeb.libraryMs
          ? "plex"
          : "tie",
    detailsWinner:
      report.multiplexProduction.detailsMs < report.plexWeb.detailsMs
        ? "multiplex"
        : report.multiplexProduction.detailsMs > report.plexWeb.detailsMs
          ? "plex"
          : "tie",
    libraryDeltaMs:
      report.multiplexProduction.libraryMs - report.plexWeb.libraryMs,
    detailsDeltaMs:
      report.multiplexProduction.detailsMs - report.plexWeb.detailsMs,
  };

  await page.screenshot({
    path: `${OUT_DIR}/plex-profile-final.png`,
    fullPage: false,
  });
  await writeFile(
    `${OUT_DIR}/soft-nav-prod-report.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await context.close();

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
