/**
 * Sign into app.plex.tv properly, then measure Your Media → Movies → details.
 */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const EMAIL = process.env.MULTIPLEX_ACCOUNT_EMAIL;
const PASSWORD = process.env.MULTIPLEX_ACCOUNT_PASSWORD;
const OUT_DIR = "/opt/cursor/artifacts/browse-compare";
const RUNS = 3;

if (!EMAIL || !PASSWORD) throw new Error("missing plex creds");

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

async function signInPlex(page) {
  await page.goto("https://app.plex.tv/desktop/#!/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2500);

  const signIn = page
    .getByRole("button", { name: /^sign in$/i })
    .or(page.getByRole("link", { name: /^sign in$/i }))
    .first();

  if (await signIn.isVisible().catch(() => false)) {
    console.log("Clicking Sign In…");
    await signIn.click();
    await page.waitForTimeout(2000);

    // Auth may open a new page/tab or stay in iframe.
    let authPage = page;
    const pages = page.context().pages();
    for (const p of pages) {
      if (p.url().includes("plex.tv/auth") || p.url().includes("auth")) {
        authPage = p;
        break;
      }
    }

    // Prefer iframe auth-form when present.
    const frame = authPage.frameLocator('iframe[src*="auth-form"]');
    const emailBtn = frame.getByTestId("signIn--email");
    if (await emailBtn.count()) {
      await emailBtn.click({ timeout: 20_000 });
      await frame.locator("#email").fill(EMAIL);
      await frame.locator("#password").fill(PASSWORD);
      await frame.getByTestId("signIn--submit").click();
    } else if (await authPage.locator("#email").count()) {
      await authPage.locator("#email").fill(EMAIL);
      await authPage.locator("#password").fill(PASSWORD);
      await authPage.getByRole("button", { name: /sign in|log in/i }).click();
    } else {
      // Fallback: top-level auth page without iframe yet
      await authPage.waitForTimeout(2000);
      const f2 = authPage.frameLocator("iframe").first();
      if (await f2.getByTestId("signIn--email").count()) {
        await f2.getByTestId("signIn--email").click();
        await f2.locator("#email").fill(EMAIL);
        await f2.locator("#password").fill(PASSWORD);
        await f2.getByTestId("signIn--submit").click();
      } else {
        await page.screenshot({
          path: `${OUT_DIR}/plex-signin-stuck.png`,
          fullPage: false,
        });
        throw new Error("Could not find plex auth form");
      }
    }

    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      for (const label of [/authorize/i, /allow/i, /^continue$/i, /got it/i, /^ok$/i]) {
        for (const p of page.context().pages()) {
          const btn = p.getByRole("button", { name: label });
          if (await btn.count()) {
            try {
              await btn.first().click({ timeout: 800 });
            } catch {
              /* optional */
            }
          }
        }
      }
      const signedOut = await page
        .getByRole("button", { name: /^sign up$/i })
        .first()
        .isVisible()
        .catch(() => false);
      if (!signedOut) {
        console.log("Signed in (Sign Up gone)");
        break;
      }
      await page.waitForTimeout(500);
    }
  } else {
    console.log("Already signed in (no Sign In control)");
  }

  await page.goto("https://app.plex.tv/desktop/#!/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: `${OUT_DIR}/plex-after-signin.png`,
    fullPage: false,
  });

  // Your Media
  const yourMedia = page.getByText(/^Your Media$/i).first();
  await yourMedia.click({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: `${OUT_DIR}/plex-your-media-ok.png`,
    fullPage: false,
  });

  // Must see Movies (server libraries), not "Add your media to Plex"
  const addMedia = await page
    .getByText(/add your media to plex/i)
    .first()
    .isVisible()
    .catch(() => false);
  if (addMedia) {
    throw new Error("Still on empty Your Media — sign-in did not attach server libraries");
  }
  await page.getByText(/^Movies$/i).first().waitFor({
    state: "visible",
    timeout: 60_000,
  });
}

async function measureOnce(page) {
  // Back to Your Media home
  const yourMedia = page.getByText(/^Your Media$/i).first();
  if (await yourMedia.isVisible().catch(() => false)) {
    await yourMedia.click();
    await page.waitForTimeout(1000);
  }
  // Prefer Home under Your Media if present
  const home = page.getByText(/^Home$/i).first();
  if (await home.isVisible().catch(() => false)) {
    await home.click();
    await page.waitForTimeout(800);
  }

  const movies = page.getByText(/^Movies$/i).first();
  await movies.waitFor({ state: "visible", timeout: 30_000 });
  await movies.hover().catch(() => {});
  await page.waitForTimeout(1200);

  const libStart = Date.now();
  await movies.click();
  await waitPosters(page, 3);
  const libraryMs = Date.now() - libStart;

  const posterImg = page.locator("img").filter({
    hasNot: page.locator("[src*='avatar'], [src*='icon']"),
  });
  // Click a large poster image
  const big = page.locator("img").nth(2);
  await big.waitFor({ state: "visible", timeout: 30_000 });
  await big.hover().catch(() => {});
  await page.waitForTimeout(1200);

  const detailsStart = Date.now();
  await big.click({ force: true });
  await page.waitForFunction(
    () => {
      const bigImg = [...document.querySelectorAll("img")].some(
        (i) => i.complete && i.naturalWidth > 250,
      );
      const text = document.body?.innerText ?? "";
      return bigImg && /\b(19|20)\d{2}\b|Play/i.test(text);
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
  const page = await context.newPage();

  await signInPlex(page);
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
    runs,
    libraryMs: median(runs.map((r) => r.libraryMs)),
    detailsMs: median(runs.map((r) => r.detailsMs)),
  };
  await page.screenshot({
    path: `${OUT_DIR}/plex-soft-final.png`,
    fullPage: false,
  });
  await writeFile(
    `${OUT_DIR}/plex-soft-nav-only.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
