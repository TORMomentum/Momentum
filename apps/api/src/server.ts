import { buildApp } from "./app.js";
import { loadEnvFile } from "./core/env-file.js";
import { loadConfig } from "./core/config.js";
import { connect, disconnect, ensureIndexes } from "./core/db.js";

/**
 * Starts the HTTP API: read the configuration, connect the database, make sure
 * the indexes exist, then serve.
 *
 * Configuration is validated before anything is opened, so a missing MinIO
 * credential fails at boot with the field named, rather than on the first
 * upload hours later. Indexes are ensured here because the unique index on
 * `contentHash` IS the dedupe guarantee — serving intake without it would
 * accept duplicates silently.
 */
async function main(): Promise<void> {
  loadEnvFile();
  const config = loadConfig(process.env);
  const db = await connect(config.mongoUrl);
  await ensureIndexes(db);

  const app = buildApp(config, db);
  // Bind all interfaces so the container port mapping reaches it.
  const host = process.env.API_HOST ?? "0.0.0.0";

  const server = app.listen(config.apiPort, host, () => {
    console.log(
      JSON.stringify({ event: "api_listening", host, port: config.apiPort, prefix: "/api/v1" }),
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(JSON.stringify({ event: "api_shutdown", signal }));
    server.close();
    await disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ event: "api_start_failed", error: String(error) }));
  process.exit(1);
});
