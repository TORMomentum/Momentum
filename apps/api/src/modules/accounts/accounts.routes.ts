import { Router } from "express";
import { z } from "zod";
import { UnauthorizedError } from "../../core/errors.js";
import { authRateLimit } from "../../core/auth-rate-limit.js";
import { requireSameOrigin } from "../../core/require-same-origin.js";
import type { Config } from "../../core/config.js";
import type { Mailer } from "../../ports/mailer.port.js";
import { AccountsRepository, normalizeEmail } from "./accounts.repository.js";
import { AccountTokensRepository } from "./account-tokens.repository.js";
import { SessionsRepository } from "./sessions.js";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password.js";
import { accountAlreadyExistsEmail, passwordResetEmail, verificationEmail } from "./account-email.template.js";

const loginSchema = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(1024) });
const credentialsSchema = z.object({ email: z.string().email().max(320), password: z.string().min(8).max(1024) });
const tokenSchema = z.object({ token: z.string().min(1).max(1024) });
const changeSchema = z.object({ currentPassword: z.string().min(1).max(1024), password: z.string().min(8).max(1024) });
const registerSchema = credentialsSchema.extend({ consent: z.literal(true), displayName: z.string().trim().min(1).max(200).optional() });
const AUTH_FAILURE = "ไม่สามารถเข้าสู่ระบบได้";

export interface AccountsRouterDeps {
  config: Config;
  accounts: AccountsRepository;
  tokens: AccountTokensRepository;
  sessions: SessionsRepository;
  mailer: Mailer;
}

function tokenUrl(origin: string, path: string, token: string): string {
  const url = new URL(path, origin);
  url.searchParams.set("token", token);
  return url.toString();
}

export function buildAccountsRouter(deps: AccountsRouterDeps): Router {
  const router = Router();
  const writes = [requireSameOrigin(deps.config.appOrigin), ...authRateLimit(deps.config)];

  /**
   * Whether the address is already registered is not disclosed — and that has
   * to hold for how long the reply takes, not only for what it says. Both paths
   * therefore do the same work: one argon2 hash, which dominates the cost, and
   * one email. An unverified account re-sends its verification link, which is
   * also what a user who lost the first one needs; a verified one is told
   * someone tried, which is the only way its owner would ever find out.
   */
  router.post("/register", ...writes, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password, deps.config);
    const existing = await deps.accounts.findByEmail(email);

    if (existing?.emailVerifiedAt) {
      await deps.mailer.send(accountAlreadyExistsEmail(email, new URL("/login", deps.config.appOrigin).toString()));
      res.status(202).json({ ok: true });
      return;
    }

    const accountId = existing
      ? existing._id.toString()
      : (
          await deps.accounts.create({
            email,
            displayName: input.displayName ?? email.split("@")[0] ?? email,
            passwordHash,
            consent: {
              noticeVersion: deps.config.consentNotice.version,
              noticeHash: deps.config.consentNotice.hash,
              agreedAt: new Date(),
              action: "checkbox",
            },
          })
        ).id;

    const token = await deps.tokens.create(accountId, "verify", deps.config.verifyTokenTtlMs);
    await deps.mailer.send(verificationEmail(email, tokenUrl(deps.config.appOrigin, "/verify", token)));
    res.status(202).json({ ok: true });
  });

  router.post("/verify", ...writes, async (req, res) => {
    const consumed = await deps.tokens.consume(tokenSchema.parse(req.body).token, "verify");
    if (!consumed) throw new UnauthorizedError(AUTH_FAILURE);
    await deps.accounts.markVerified(consumed.accountId);
    res.json({ ok: true });
  });

  router.post("/login", ...writes, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const account = await deps.accounts.findByEmail(input.email);
    const valid = account?.passwordHash ? await verifyPassword(account.passwordHash, input.password) : await verifyAgainstDummy(input.password, deps.config);
    if (!account || !account.passwordHash || !account.emailVerifiedAt || !valid) throw new UnauthorizedError(AUTH_FAILURE);
    const session = await deps.sessions.create(account.id);
    res.json({ sessionId: session.id, expiresAt: session.expiresAt.toISOString() });
  });

  router.post("/logout", ...writes, async (req, res) => {
    const id = req.get("x-session-id");
    if (id) await deps.sessions.revoke(id);
    res.json({ ok: true });
  });

  router.post("/password/forgot", ...writes, async (req, res) => {
    const { email } = z.object({ email: z.string().email().max(320) }).parse(req.body);
    const account = await deps.accounts.findByEmail(email);
    if (account?.passwordHash && account.emailVerifiedAt) {
      const token = await deps.tokens.create(account.id, "reset", deps.config.resetTokenTtlMs);
      await deps.mailer.send(passwordResetEmail(account.email, tokenUrl(deps.config.appOrigin, "/reset-password", token)));
    }
    res.status(202).json({ ok: true });
  });

  router.post("/password/reset", ...writes, async (req, res) => {
    const input = tokenSchema.extend({ password: z.string().min(8).max(1024) }).parse(req.body);
    const consumed = await deps.tokens.consume(input.token, "reset");
    if (!consumed) throw new UnauthorizedError(AUTH_FAILURE);
    await deps.accounts.setPassword(consumed.accountId, await hashPassword(input.password, deps.config));
    await deps.sessions.revokeAllForAccount(consumed.accountId);
    res.json({ ok: true });
  });

  router.post("/password/change", ...writes, async (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const input = changeSchema.parse(req.body);
    const account = req.auth.account;
    if (!account.passwordHash || !await verifyPassword(account.passwordHash, input.currentPassword)) throw new UnauthorizedError(AUTH_FAILURE);
    const sessionId = req.get("x-session-id");
    if (!sessionId) throw new UnauthorizedError();
    await deps.accounts.setPassword(account._id.toString(), await hashPassword(input.password, deps.config));
    await deps.sessions.revokeAllForAccountExcept(account._id.toString(), sessionId);
    res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    if (!req.auth) throw new UnauthorizedError();
    const account = req.auth.account;
    res.json({ id: account._id.toString(), email: account.email, displayName: account.displayName, role: account.role, emailVerifiedAt: account.emailVerifiedAt?.toISOString() });
  });
  return router;
}
