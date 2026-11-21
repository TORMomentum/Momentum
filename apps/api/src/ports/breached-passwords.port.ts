/**
 * Asks an outside corpus of leaked passwords whether this one is in it (TOR-320,
 * ASVS V6.2.4). The password never leaves the process: an adapter may disclose
 * at most a short hash prefix.
 *
 * `occurrences` is how many times the corpus has seen it (0 = not found). A
 * rejection means the corpus could not be consulted; the caller decides what
 * that means (accounts treat it as "unknown", see breached-password.ts).
 */
export interface BreachedPasswords {
  occurrences(password: string): Promise<number>;
}
