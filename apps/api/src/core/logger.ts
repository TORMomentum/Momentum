/**
 * The one logger (ASVS V16.3). JSON lines on stdout; `severity` and `message`
 * are the field names Cloud Logging parses. Everything passes through one
 * sanitizer, so a caller cannot put a password, a token, a session id, or a
 * request/document body into a log line by accident.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type Fields = Record<string, unknown>;

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SEVERITY: Record<LogLevel, string> = { debug: "DEBUG", info: "INFO", warn: "WARNING", error: "ERROR" };

/** The fixed vocabulary of security events (docs/ARCHITECTURE.md, Logging). */
export const SECURITY_EVENTS = {
  "auth.login.success": "info",
  "auth.login.failure": "warn",
  "auth.logout": "info",
  "auth.denied": "warn",
  "ratelimit.hit": "warn",
  "admin.action": "info",
} as const satisfies Record<string, LogLevel>;
export type SecurityEvent = keyof typeof SECURITY_EVENTS;

/** Keys whose values never reach a log: credentials, and request/document payloads. */
const SENSITIVE_KEY = /pass(word|wd)?|token|secret|authorization|cookie|api[-_]?key|session|credential|^body$|^content$|^bytes$|^text$/i;
const MAX_DEPTH = 4;
const MAX_STRING = 500;
const REDACTED = "[redacted]";

export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...` : value;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return "[bytes]";
  if (value instanceof Error) return { name: value.name, message: sanitize(value.message, depth + 1) };
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, depth + 1)]),
    );
  }
  return String(value);
}

type Sink = (line: string) => void;
const stdout: Sink = (line) => { process.stdout.write(`${line}\n`); };

let threshold: LogLevel = "info";
let sink: Sink = stdout;

/** Called once at startup with `config.logLevel`. */
export function configureLogger(level: LogLevel): void { threshold = level; }
/** Tests only: capture lines; call with no argument to restore stdout. */
export function setLogSink(next?: Sink): void { sink = next ?? stdout; }

function write(level: LogLevel, message: string, fields: Fields = {}, extra: Fields = {}): void {
  if (RANK[level] < RANK[threshold]) return;
  const clean = sanitize(fields) as Fields;
  // The reserved keys are written last so a caller's field cannot overwrite them.
  sink(JSON.stringify({ ...clean, ...extra, severity: SEVERITY[level], message, time: new Date().toISOString() }));
}

export const logger = {
  debug: (message: string, fields?: Fields) => write("debug", message, fields),
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
  /** A security event from the fixed vocabulary; the message is the event name. */
  security: (event: SecurityEvent, fields?: Fields) => write(SECURITY_EVENTS[event], event, fields, { category: "security" }),
};
