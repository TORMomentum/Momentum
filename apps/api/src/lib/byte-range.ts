/**
 * One `Range` header against one object size (RFC 9110 §14).
 *
 * Only a single byte range is honoured. Multiple or malformed ranges are
 * IGNORED and the whole object is served — the RFC permits a server to ignore
 * Range, and doing so is safer than trying to answer a multipart/byteranges
 * request nobody here needs. A PDF viewer asks for one range at a time.
 */
export type RangeResult =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: "full" };

  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return { kind: "full" };

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return { kind: "full" };
  if (size === 0) return { kind: "unsatisfiable" };

  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (suffix === 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return { kind: "unsatisfiable" };

  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return { kind: "full" };

  return { kind: "partial", start, end };
}
