import { logger } from "../../core/logger.js";
import { readFileSync } from "node:fs";
import { AppError } from "../../core/errors.js";
import type { Config } from "../../core/config.js";
import type { BreachedPasswords } from "../../ports/breached-passwords.port.js";

export const BREACHED_PASSWORD_MESSAGE = "รหัสผ่านนี้อยู่ในรายการรหัสผ่านที่รั่วไหลหรือใช้กันทั่วไป กรุณาตั้งรหัสผ่านอื่น";

/** A 422 the web forms recognise by `code`, so they can show the message beside the password field. */
export class BreachedPasswordError extends AppError {
  constructor() {
    super(422, "password_breached", BREACHED_PASSWORD_MESSAGE);
  }
}

/** SecLists top-10k (MIT), see the file's header. Read once, lower-cased. */
const COMMON = new Set(
  readFileSync(new URL("../../data/common-passwords.txt", import.meta.url), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("# "))
    .map((line) => line.toLowerCase()),
);

export function isCommonPassword(password: string): boolean {
  return COMMON.has(password.toLowerCase());
}

/**
 * Refuses a password that is on the bundled common list, or that the breach
 * corpus has seen. The local list is ALWAYS checked (cheap, offline). The corpus
 * is best effort: when it is unreachable or slow the password is accepted unless
 * the local list caught it (fail open on the corpus only — an outage of a third
 * party must not stop anyone registering or recovering an account) and a
 * `breached_password_check_unavailable` warning is logged with no password,
 * hash or prefix in it.
 */
export async function assertPasswordNotBreached(
  password: string,
  checker: BreachedPasswords,
  config: Config["hibp"],
): Promise<void> {
  if (isCommonPassword(password)) throw new BreachedPasswordError();
  if (!config.enabled) return;
  let seen: number;
  try {
    seen = await checker.occurrences(password);
  } catch (error) {
    logger.warn("breached_password_check_unavailable", { reason: error instanceof Error ? error.name : "unknown" });
    return;
  }
  if (seen >= config.minCount) throw new BreachedPasswordError();
}
