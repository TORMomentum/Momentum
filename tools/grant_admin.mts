/**
 * Makes an existing account an admin, or takes it back (TOR-199, spec 2026-11-25-admin-accounts decision 6).
 *
 *   npx tsx tools/grant_admin.mts --email someone@example.com            report the account and its role
 *   npx tsx tools/grant_admin.mts --email someone@example.com --apply    make it an admin
 *   npx tsx tools/grant_admin.mts --email someone@example.com --revoke --apply   make it a vendor again
 *
 * The first admin has no one to promote them from the vendor screen, so this is how one starts. The account must
 * already exist (signed up and confirmed, or signed in with Google). A role change signs the account out
 * everywhere, as the vendor screen's does: no session opened under one role carries on under another.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect } from "../apps/api/src/core/db.js";
import { AccountsRepository } from "../apps/api/src/modules/accounts/accounts.repository.js";
import { SessionsRepository } from "../apps/api/src/modules/accounts/sessions.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const args = process.argv.slice(2);
const email = args[args.indexOf("--email") + 1];
const APPLY = args.includes("--apply");
const role = args.includes("--revoke") ? "vendor" : "admin";
if (!args.includes("--email") || !email || email.startsWith("--")) {
  console.error("usage: npx tsx tools/grant_admin.mts --email <address> [--revoke] [--apply]");
  process.exit(2);
}

const config = loadConfig(process.env);
const db = await connect(config.mongoUrl);
const sessions = new SessionsRepository(db, config.session);
const repo = new AccountsRepository(db, sessions);

try {
  const account = await repo.findByEmail(email);
  if (!account) {
    console.error(`no account for ${email}: sign up (or sign in with Google) first`);
    process.exitCode = 1;
  } else if (account.role === role) {
    console.log(`${email} is already ${role}; nothing to do`);
  } else if (!APPLY) {
    console.log(`${email}: ${account.role} → ${role} (dry run; add --apply to write it, which signs the account out)`);
  } else {
    await repo.changeRole(account._id.toString(), role);
    console.log(`${email}: ${account.role} → ${role}; its sessions are revoked, so it signs in again`);
  }
} finally {
  await disconnect();
}
