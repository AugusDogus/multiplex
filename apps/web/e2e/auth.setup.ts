import { test as setup, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  ACCOUNTS,
  storageStatePath,
  type AccountConfig,
} from "./helpers/accounts";
import { loginToMultiplex, readCredentials } from "./helpers/plex-login";

// Log each account in once and persist its session, so the actual tests can
// open two pre-authenticated contexts without re-running the slow OAuth dance.
for (const account of ACCOUNTS) {
  setup(`authenticate ${account.label}`, async ({ page }) => {
    const credentials = readCredentials(account.loginVar, account.passwordVar);
    await authenticateAccount(page, account, credentials);
  });
}

async function authenticateAccount(
  page: Page,
  account: AccountConfig,
  credentials: { login: string; password: string },
): Promise<void> {
  const statePath = storageStatePath(account);
  await mkdir(path.dirname(statePath), { recursive: true });
  await loginToMultiplex(page, credentials);
  await page.context().storageState({ path: statePath });
}
