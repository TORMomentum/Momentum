import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "../../core/config.js";
import { logger } from "../../core/logger.js";
import { UnauthorizedError } from "../../core/errors.js";
import type { Mailer } from "../../ports/mailer.port.js";
import { verificationEmail } from "./account-email.template.js";
import type { GoogleOidc } from "../../ports/google-oidc.port.js";
import { AccountTokensRepository } from "./account-tokens.repository.js";
import { AccountsRepository, normalizeEmail } from "./accounts.repository.js";
import { GoogleSigninRepository, sha256Hex } from "./google-signin.repository.js";
import { SessionsRepository } from "./sessions.js";

/** One message for every way a Google sign-in can fail: the reason is for the log, not the browser. */
export const GOOGLE_FAILURE = "ไม่สามารถเข้าสู่ระบบด้วย Google ได้";

export type GoogleSignedIn = { status: "signed_in"; sessionId: string; expiresAt: string };
export type GoogleCallbackResult = GoogleSignedIn | { status: "consent_required"; ticket: string; checkMailbox?: true };

export interface GoogleSigninDeps {
  config: Config;
  oidc: GoogleOidc;
  mailer: Mailer;
  repository: GoogleSigninRepository;
  accounts: AccountsRepository;
  tokens: AccountTokensRepository;
  sessions: SessionsRepository;
}

function equalDigests(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function equalSecrets(a: string, b: string): boolean {
  // Hashing first gives both sides equal length, which timingSafeEqual requires.
  return equalDigests(sha256Hex(a), sha256Hex(b));
}

/**
 * Sign in with Google: authorization code flow with PKCE, `state` + `nonce`, and an ID token validated claim by
 * claim (accounts spec 2.6 and its 2026-11-21 revision). No token, code or verifier is ever logged or returned.
 */
export class GoogleSigninService {
  constructor(private readonly deps: GoogleSigninDeps) {}

  /** `binding` goes to the browser in an httpOnly cookie; only its digest is kept, so the callback can prove it is the same browser. */
  async start(linkAccountId?: string): Promise<{ url: string; binding: string }> {
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const binding = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    await this.deps.repository.saveTransaction(
      { _id: sha256Hex(state), bindingHash: sha256Hex(binding), nonce, codeVerifier, ...(linkAccountId ? { linkAccountId } : {}) },
      this.deps.config.googleOauth.transactionTtlMs,
    );
    return { url: this.deps.oidc.authorizationUrl({ state, nonce, codeChallenge }), binding };
  }

  async callback(input: { code: string; state: string; binding: string }, currentAccountId?: string): Promise<GoogleCallbackResult> {
    // Consumed first and unconditionally: a transaction can be tried once, so a wrong guess burns it.
    const transaction = await this.deps.repository.consumeTransaction(sha256Hex(input.state));
    if (!transaction) throw fail();
    if (!equalDigests(sha256Hex(input.binding), transaction.bindingHash)) throw fail();

    let identity;
    try {
      identity = await this.deps.oidc.exchange({ code: input.code, codeVerifier: transaction.codeVerifier });
    } catch {
      throw fail();
    }
    if (!identity.nonce || !equalSecrets(identity.nonce, transaction.nonce)) throw fail();
    // An address Google does not vouch for proves nothing, so it is never used to find, link or create an account.
    if (identity.emailVerified !== true) throw fail();
    const email = normalizeEmail(identity.email);

    const bySub = await this.deps.accounts.findByGoogleSub(identity.sub);
    if (transaction.linkAccountId && (transaction.linkAccountId !== currentAccountId || (bySub && bySub.id !== currentAccountId))) throw fail();
    if (bySub) return this.signIn(bySub);

    const byEmail = await this.deps.accounts.findByEmail(email);
    if (byEmail?.emailVerifiedAt && !byEmail.deletedAt) {
      // Only a verified account is linked: otherwise whoever registered the address first, with a password of their
      // own choosing, would be handed the real owner's Google sign-in. A different Google identity is refused.
      if (transaction.linkAccountId !== byEmail.id || byEmail.google || byEmail.disabledAt) throw fail();
      if (!await this.deps.accounts.linkGoogle(byEmail.id, identity.sub)) throw fail();
      return this.signIn(byEmail);
    }

    if (transaction.linkAccountId) throw fail();

    // No account, or one that never confirmed its address: a new account, but only after consent.
    const ticket = randomBytes(32).toString("base64url");
    const googleHostsMailbox = email.endsWith("@gmail.com") || Boolean(identity.hostedDomain);
    const proof = googleHostsMailbox ? null : randomBytes(32).toString("base64url");
    await this.deps.repository.saveSignup(
      { _id: sha256Hex(ticket), mailboxProofHash: proof ? sha256Hex(proof) : null, sub: identity.sub, email, ...(identity.name ? { displayName: identity.name } : {}) },
      this.deps.config.googleOauth.transactionTtlMs,
    );
    if (proof) {
      const url = new URL("/google-consent", this.deps.config.appOrigin);
      url.hash = new URLSearchParams({ proof }).toString();
      await this.deps.mailer.send(verificationEmail(email, url.toString()));
      return { status: "consent_required", ticket, checkMailbox: true };
    }
    return { status: "consent_required", ticket };
  }

  /** The consent step for a Google identity with no account. Consent is the same record password registration writes. */
  async complete(input: { ticket: string; proof?: string; behaviourConsent?: boolean }): Promise<GoogleSignedIn> {
    const signup = await this.deps.repository.consumeSignup(sha256Hex(input.ticket));
    if (!signup) throw fail();
    // Pre-upgrade tickets lack the proof policy and must restart.
    if (signup.mailboxProofHash !== null &&
        (!signup.mailboxProofHash || !input.proof || !equalDigests(sha256Hex(input.proof), signup.mailboxProofHash))) throw fail();
    // Re-checked, because minutes have passed since the callback: the address may have registered meanwhile.
    if (await this.deps.accounts.findByGoogleSub(signup.sub)) throw fail();
    const existing = await this.deps.accounts.findByEmail(signup.email);
    if (existing?.emailVerifiedAt) throw fail();
    if (existing) {
      const removedId = await this.deps.accounts.removeUnverifiedByEmail(signup.email);
      if (removedId) {
        await this.deps.tokens.removeAllForAccount(removedId);
        await this.deps.sessions.revokeAllForAccount(removedId);
      }
    }
    const now = new Date();
    let account;
    try {
      account = await this.deps.accounts.create({
        email: signup.email,
        displayName: signup.displayName ?? signup.email.split("@")[0] ?? signup.email,
        consent: { noticeVersion: this.deps.config.consentNotice.version, noticeHash: this.deps.config.consentNotice.hash, agreedAt: now, action: "checkbox" },
        ...(input.behaviourConsent ? { behaviourConsent: { agreedAt: now } } : {}),
        google: { sub: signup.sub },
        emailVerifiedAt: now,
      });
    } catch {
      // A unique index lost a race with another request; nothing was created.
      throw fail();
    }
    return this.signIn(account);
  }

  private async signIn(account: { id: string; disabledAt?: Date; deletedAt?: Date }): Promise<GoogleSignedIn> {
    if (account.disabledAt || account.deletedAt) throw fail();
    const session = await this.deps.sessions.create(account.id);
    logger.security("auth.login.success", { accountId: account.id, provider: "google" });
    return { status: "signed_in", sessionId: session.id, expiresAt: session.expiresAt.toISOString() };
  }
}

function fail(): UnauthorizedError {
  return new UnauthorizedError(GOOGLE_FAILURE);
}
