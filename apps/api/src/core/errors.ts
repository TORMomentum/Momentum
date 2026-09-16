import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, "bad_request", message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "unauthorized", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "not_found", message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(413, "payload_too_large", message);
  }
}

/** A dependency — object storage — did not answer. The caller may retry. */
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable") {
    super(503, "service_unavailable", message);
  }
}

/**
 * Extraction failures. These never reach the HTTP error middleware - the worker
 * catches them. `retryable` decides whether the worker backs off and tries
 * again or fails the record immediately (NFR-S5: a failed extraction keeps the
 * raw document and records the reason).
 */
export class ExtractionError extends Error {
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

/** The model returned nothing usable for the critical fields; retrying will not help. */
export class DocumentUnreadableError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "DocumentUnreadableError";
  }
}

/**
 * The single translation point from thrown errors to responses. Stack traces
 * never leave the process.
 */
export function errorMiddleware(
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  // A schema rejection is the caller's mistake, not a server fault. Without
  // this it surfaces as a 500 and the caller cannot tell a bad request from an
  // outage. The issues are returned, but never the input that produced them.
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "bad_request",
        message: "Request did not match the expected shape",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
    return;
  }
  console.error("unhandled_error", { name: error.name, message: error.message });
  res.status(500).json({ error: { code: "internal", message: "Internal server error" } });
}
