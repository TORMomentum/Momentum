/** How long an answer is kept, how long after that it may still be served while rebuilt, and how many are kept. */
export interface KeptSettings {
  keepMs: number;
  staleMs: number;
  maxEntries: number;
}

/**
 * A bounded, keyed cache of slow answers, with stale-while-revalidate.
 *
 * Inside `keepMs` an answer is served as is. After that, for up to `staleMs` more, the kept answer is still served at
 * once while a fresh one is built in the background; older than that, the caller waits for the fresh one. Callers
 * arriving while an answer is being built share it. A failed build is not kept (the next caller tries again), and a
 * kept answer survives a failed rebuild until it is too old. `keepMs` 0 turns the cache off. The oldest-used key is
 * dropped past `maxEntries`, because keys come from the query string and are the caller's to choose.
 *
 * A served answer is shared between callers, so callers must not change it.
 */
export function keptAnswers<A, T>(settings: () => KeptSettings, build: (arg: A) => Promise<T>) {
  type Entry = { at: number; value?: T; held: boolean; pending?: Promise<T> };
  const entries = new Map<string, Entry>();

  const rebuild = (key: string, arg: A, entry: Entry): Promise<T> => {
    if (entry.pending) return entry.pending;
    const startedAt = Date.now();
    entry.pending = build(arg).then(
      (value) => { entry.value = value; entry.held = true; entry.at = startedAt; entry.pending = undefined; return value; },
      (error: unknown) => {
        entry.pending = undefined;
        if (!entry.held && entries.get(key) === entry) entries.delete(key);
        throw error;
      },
    );
    return entry.pending;
  };

  return (key: string, arg: A): Promise<T> => {
    const { keepMs, staleMs, maxEntries } = settings();
    if (keepMs === 0) return build(arg);
    let entry = entries.get(key);
    if (entry) entries.delete(key);
    else {
      entry = { at: 0, held: false };
      while (entries.size >= maxEntries) entries.delete(entries.keys().next().value as string);
    }
    entries.set(key, entry);
    const age = Date.now() - entry.at;
    if (entry.held && age < keepMs) return Promise.resolve(entry.value as T);
    if (entry.held && age < keepMs + staleMs) {
      // The caller gets the kept answer now; a failed rebuild is retried by the next caller.
      rebuild(key, arg, entry).catch(() => undefined);
      return Promise.resolve(entry.value as T);
    }
    return rebuild(key, arg, entry);
  };
}
