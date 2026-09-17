import type { Config } from "../core/config.js";
import type { Storage } from "../ports/storage.port.js";
import { GcsStorage } from "./gcs.storage.js";

/**
 * The one place an object-storage adapter is constructed (spec §4.5). The API
 * and the worker both call it, so the choice of adapter and its settings
 * cannot drift between them. The deadline differs by caller: request-path
 * reads must fail fast; the worker reads whole documents.
 */
export function createStorage(config: Config, caller: "api" | "worker"): Storage {
  return new GcsStorage({
    bucket: config.gcs.bucket,
    apiEndpoint: config.gcs.apiEndpoint,
    keyFilename: config.gcs.credentialsPath,
    projectId: config.gcs.projectId,
    timeoutMs: caller === "api" ? config.gcs.timeoutApiMs : config.gcs.timeoutWorkerMs,
  });
}
