import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AccountConfig {
  /** Stable key used for the saved storage-state filename. */
  key: string;
  /** Human-readable label for logs/test titles. */
  label: string;
  loginVar: string;
  passwordVar: string;
}

const AUTH_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".auth",
);

/**
 * The two Plex accounts the Watch Together suite drives. Account A is the host
 * (creates rooms / invites); account B is the guest who joins.
 */
export const ACCOUNT_A: AccountConfig = {
  key: "account-a",
  label: "multiplextest (host)",
  loginVar: "MULTIPLEX_ACCOUNT_EMAIL",
  passwordVar: "MULTIPLEX_ACCOUNT_PASSWORD",
};

export const ACCOUNT_B: AccountConfig = {
  key: "account-b",
  label: "multiplextest2 (guest)",
  loginVar: "MUTLIPLEX_ACCOUNT_EMAIL_2",
  passwordVar: "MULTIPLEX_ACCOUNT_PASSWORD_2",
};

export const ACCOUNTS = [ACCOUNT_A, ACCOUNT_B];

export function storageStatePath(account: AccountConfig): string {
  return path.join(AUTH_DIR, `${account.key}.json`);
}
