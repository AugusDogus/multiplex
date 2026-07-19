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

async function loginPlexWeb(page) {
  await page.goto(PLEX_URL, { waitUntil: "domcontentloaded" });
  const signedIn = await page
    .getByText(/continue watching/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (signedIn) return;

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
  await page.getByText(/continue watching/i).first().waitFor({ timeout: 90_000 });
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

async function measureMultiplexSoftNav(page) {
  // Ensure home is settled
  await page.goto(MULTIPLEX_URL, { waitUntil: "domcontentloaded" });
  await page.getByText("Continue Watching", { exact: false }).first().waitFor({
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);

  // --- Library soft-nav ---
  const libraryLink = page.locator('a[href*="/media/"][href*="source="]').first();
  await libraryLink.waitFor({ state: "visible", timeout: 30_000 });
  await libraryLink.hover();
  // Give runtime + tRPC prefetch time to complete (Plex also benefits from hover).
  await page.waitForTimeout(800);

  const libStart = Date.now();
  await libraryLink.click();
  await page.waitForURL(/\/media\//, { timeout: 30_000 });
  await waitForPosterImages(page, 3);
  const libraryMs = Date.now() - libStart;
  await page.screenshot({
    path: `${OUT_DIR}/multiplex-soft-library.png`,
    fullPage: false,
  });

  // --- Details soft-nav ---
  const posterLink = page
    .locator('a[href*="/item/"][aria-label^="View details"]')
    .first();
  await posterLink.waitFor({ state: "visible", timeout: 30_000 });
  await posterLink.hover();
  await page.waitForTimeout(800);

  const detailsStart = Date.now();
  await posterLink.click();
  await page.waitForURL(/\/item\//, { timeout: 30_000 });
  // Hero title or play affordance — details content, not just shell.
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
  await page.screenshot({
    path: `${OUT_DIR}/multiplex-soft-details.png`,
    fullPage: false,
  });

  return { libraryMs, detailsMs };
}

async function measurePlexSoftNav(page) {
  await page.goto(PLEX_URL, { waitUntil: "domcontentloaded" });
  await page.getByText(/continue watching/i).first().waitFor({ timeout: 90_000 });
  await page.waitForTimeout(2000);

  // Prefer a Movies/TV library in the sidebar/source list.
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
    // Fallback: any source row that is not Home / Live TV
    libraryTarget = page
      .locator('[class*="Source"], [data-testid*="source"], a, button')
      .filter({ hasText: /movies|tv shows|library/i })
      .first();
  }

  await libraryTarget.waitFor({ state: "visible", timeout: 30_000 });
  await libraryTarget.hover().catch(() => {});
  await page.waitForTimeout(800);

  const libStart = Date.now();
  await libraryTarget.click();
  await page.waitForTimeout(100);
  await waitForPosterImages(page, 3);
  const libraryMs = Date.now() - libStart;
  await page.screenshot({
    path: `${OUT_DIR}/plex-soft-library.png`,
    fullPage: false,
  });

  // Details: click a poster-sized image / poster link
  const poster = page.locator('a[href*="/details"], a[href*="preplay"], [class*="Poster"] a, img').first();
  // Prefer clicking a large poster image's nearest link
  const posterLink = page.locator("a").filter({ has: page.locator("img") }).first();
  const target = (await posterLink.count()) ? posterLink : poster;
  await target.hover().catch(() => {});
  await page.waitForTimeout(800);

  const detailsStart = Date.now();
  await target.click();
  await page.waitForFunction(
    () => {
      const h1 = document.querySelector("h1, [class*='Title'], [data-testid*='title']");
      const titleOk =
        !!h1 && (h1.textContent ?? "").trim().length > 1 && (h1.textContent ?? "").trim().length < 200;
      const bigImg = [...document.querySelectorAll("img")].some(
        (img) => img.complete && img.naturalWidth > 300,
      );
      return titleOk && bigImg;
    },
    null,
    { timeout: 60_000 },
  );
  const detailsMs = Date.now() - detailsStart;
  await page.screenshot({
    path: `${OUT_DIR}/plex-soft-details.png`,
    fullPage: false,
  });

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
      "Soft-nav after 800ms hover prefetch. Metric is click→content visible. Multiplex on localhost; Plex on CDN.",
    multiplex: {},
    plexWeb: {},
  };

  const muxPage = await context.newPage();
  console.log("Logging into Multiplex…");
  await loginMultiplex(muxPage);
  console.log("Multiplex soft-nav…");
  report.multiplex = await measureMultiplexSoftNav(muxPage);
  console.log("Multiplex:", report.multiplex);

  const plexPage = await context.newPage();
  console.log("Logging into Plex web…");
  await loginPlexWeb(plexPage);
  console.log("Plex soft-nav…");
  report.plexWeb = await measurePlexSoftNav(plexPage);
  console.log("Plex:", report.plexWeb);

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
