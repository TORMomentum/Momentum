import { logger } from "./logger.js";

/**
 * An error nobody caught would otherwise reach stderr as a bare stack trace, which Cloud Logging stores as an
 * unlabelled line that no alert can match. These two handlers write it through the one logger as `severity: ERROR`
 * and then exit, so Cloud Run restarts the instance (the process is in an unknown state after either event).
 * `error.stack` is left out on purpose: the sanitizer keeps only name and message.
 */
export function installProcessErrorHandlers(proc: Pick<NodeJS.Process, "on" | "exit"> = process): void {
  const fatal = (event: string) => (reason: unknown): void => {
    logger.error(event, { error: reason instanceof Error ? reason : new Error(String(reason)) });
    proc.exit(1);
  };
  proc.on("uncaughtException", fatal("uncaught_exception"));
  proc.on("unhandledRejection", fatal("unhandled_rejection"));
}
