import type { AccountRole, AdminAuditDocument } from "../../core/db.js";
import { BadRequestError } from "../../core/errors.js";
import type { Mailer } from "../../ports/mailer.port.js";
import { passwordResetEmail, verificationEmail } from "../accounts/account-email.template.js";
import type { AccountTokensRepository } from "../accounts/account-tokens.repository.js";
import type { AccountsRepository } from "../accounts/accounts.repository.js";
import { tokenUrl } from "../accounts/accounts.routes.js";
import type { SessionsRepository } from "../accounts/sessions.js";
import type { ProfileRepository, VendorProfileInput } from "../profile/profile.repository.js";
import { emptyProfile, profileResponse } from "../profile/profile.routes.js";
import type { AdminAccountDetail, AdminAccountPage, AdminAccountsRepository } from "./admin-accounts.repository.js";

export interface AdminAccountsDeps {
  repo: AdminAccountsRepository;
  accounts: AccountsRepository;
  profiles: ProfileRepository;
  sessions: SessionsRepository;
  tokens: AccountTokensRepository;
  mailer: Mailer;
  appOrigin: string;
  verifyTokenTtlMs: number;
  resetTokenTtlMs: number;
}

/** How many audit entries the account screen shows. */
const AUDIT_SHOWN = 30;

/**
 * Looking after vendor accounts (FR-G, NFR-S2). Personal data is involved, so three rules hold:
 * every view and every change is written to the audit log with the admin who did it; an admin
 * never sees or sets a password — only sends the vendor a reset link; and a profile an admin
 * edits says so to the vendor.
 */
export class AdminAccountsService {
  constructor(private readonly deps: AdminAccountsDeps) {}

  list(q: string | undefined, page: number, pageSize: number): Promise<AdminAccountPage> {
    return this.deps.repo.list(q, page, pageSize);
  }

  /** Opening an account is itself recorded: reading someone's data is an action. */
  async open(accountId: string, actor: string): Promise<{
    account: AdminAccountDetail;
    profile: ReturnType<typeof profileResponse>;
    audit: AdminAuditDocument[];
  }> {
    const account = await this.deps.repo.load(accountId);
    await this.deps.repo.audit({ accountId, action: "viewed", actor });
    const profile = await this.deps.profiles.findByAccountId(accountId);
    return {
      account,
      profile: profileResponse(profile ?? emptyProfile()),
      audit: await this.deps.repo.auditFor(accountId, AUDIT_SHOWN),
    };
  }

  async editProfile(accountId: string, input: VendorProfileInput, actor: string): Promise<void> {
    await this.deps.repo.load(accountId);
    await this.deps.profiles.replace(accountId, input, "admin");
    await this.deps.repo.audit({ accountId, action: "profile-edited", actor });
  }

  async changeRole(accountId: string, role: AccountRole, actor: string): Promise<void> {
    const account = await this.deps.repo.load(accountId);
    if (account.role === role) return;
    // AccountsRepository revokes every session, so the old role's permissions end now.
    await this.deps.accounts.changeRole(accountId, role);
    await this.deps.repo.audit({ accountId, action: "role-changed", actor, detail: `${account.role} → ${role}` });
  }

  async setDisabled(accountId: string, disabled: boolean, actor: string, reason?: string): Promise<void> {
    await this.deps.repo.setDisabled(accountId, disabled);
    if (disabled) await this.deps.sessions.revokeAllForAccount(accountId);
    await this.deps.repo.audit({ accountId, action: disabled ? "disabled" : "enabled", actor, ...(reason ? { detail: reason } : {}) });
  }

  /** For a vendor whose first link expired or never arrived. A verified account needs none. */
  async resendVerification(accountId: string, actor: string): Promise<void> {
    const account = await this.deps.repo.load(accountId);
    if (account.verified) throw new BadRequestError("บัญชีนี้ยืนยันอีเมลแล้ว");
    const token = await this.deps.tokens.create(accountId, "verify", this.deps.verifyTokenTtlMs);
    await this.deps.mailer.send(verificationEmail(account.email, tokenUrl(this.deps.appOrigin, "/verify", token)));
    await this.deps.repo.audit({ accountId, action: "verification-email-sent", actor });
  }

  /** The safe way to "fix a password": the vendor sets it themselves from the link. */
  async sendPasswordReset(accountId: string, actor: string): Promise<void> {
    const account = await this.deps.repo.load(accountId);
    if (!account.verified) throw new BadRequestError("ต้องยืนยันอีเมลก่อน — ส่งอีเมลยืนยันแทน");
    if (account.disabled) throw new BadRequestError("บัญชีนี้ถูกระงับอยู่");
    const token = await this.deps.tokens.create(accountId, "reset", this.deps.resetTokenTtlMs);
    await this.deps.mailer.send(passwordResetEmail(account.email, tokenUrl(this.deps.appOrigin, "/reset-password", token)));
    await this.deps.repo.audit({ accountId, action: "password-reset-sent", actor });
  }
}
