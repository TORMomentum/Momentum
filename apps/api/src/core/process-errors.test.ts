import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureLogger, setLogSink } from "./logger.js";
import { installProcessErrorHandlers } from "./process-errors.js";

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = [];
  setLogSink((line) => lines.push(JSON.parse(line) as Record<string, unknown>));
  configureLogger("info");
});
afterEach(() => setLogSink());

function fakeProcess() {
  const emitter = new EventEmitter();
  const exit = vi.fn();
  installProcessErrorHandlers(Object.assign(emitter, { exit }) as never);
  return { emitter, exit };
}

describe("installProcessErrorHandlers", () => {
  it("logs an uncaught exception as ERROR with name and message, then exits 1", () => {
    const { emitter, exit } = fakeProcess();
    emitter.emit("uncaughtException", new TypeError("boom"));
    expect(lines).toEqual([expect.objectContaining({ severity: "ERROR", message: "uncaught_exception", error: { name: "TypeError", message: "boom" } })]);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("logs an unhandled rejection even when the reason is not an Error", () => {
    const { emitter, exit } = fakeProcess();
    emitter.emit("unhandledRejection", "plain string");
    expect(lines).toEqual([expect.objectContaining({ severity: "ERROR", message: "unhandled_rejection", error: { name: "Error", message: "plain string" } })]);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("never writes a stack trace", () => {
    const { emitter } = fakeProcess();
    emitter.emit("uncaughtException", new Error("x"));
    expect(JSON.stringify(lines)).not.toContain("stack");
  });
});
