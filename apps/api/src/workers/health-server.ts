import { createServer } from "node:http";

/**
 * ponytail: exists only so Cloud Run's startup and liveness probes have
 * something to hit (TOR-140) — the worker itself is a poll loop with no
 * request to serve. Compose and local dev never call this.
 */
export function startHealthServer(port: number): void {
  createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  }).listen(port);
}
