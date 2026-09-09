import express from "express";
import { sourcesRouter } from "./routes/sources";

export const app = express();

app.use(express.json());

// Liveness/readiness probe — used by CI, Docker healthchecks, and the web app.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "tor-radar-api" });
});

// Read-only view of the BMA eGP source system (docs/DATA-SOURCES.md).
app.use("/sources", sourcesRouter);
