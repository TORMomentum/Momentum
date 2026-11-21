import { createHash } from "node:crypto";
import type { Config } from "../core/config.js";
import type { BreachedPasswords } from "../ports/breached-passwords.port.js";

/**
 * Have I Been Pwned "Pwned Passwords" range API (k-anonymity). The SHA-1 of the
 * password is split: the first 5 hex characters go out, the service returns every
 * suffix sharing that prefix, and the comparison happens here. The password and
 * its full hash are never sent and never logged. `Add-Padding` makes the reply
 * size uninformative about how many real matches the prefix has.
 */
export class HibpBreachedPasswords implements BreachedPasswords {
  constructor(private readonly config: Config["hibp"], private readonly fetchImpl: typeof fetch = fetch) {}

  async occurrences(password: string): Promise<number> {
    const digest = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    const base = this.config.apiUrl.endsWith("/") ? this.config.apiUrl : `${this.config.apiUrl}/`;
    const response = await this.fetchImpl(`${base}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "tor-radar-password-check" },
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    if (!response.ok) throw new Error(`range API answered ${response.status}`);
    for (const line of (await response.text()).split("\n")) {
      const [candidate, count] = line.trim().split(":");
      if (candidate === suffix) return Number(count) || 0;
    }
    return 0;
  }
}
