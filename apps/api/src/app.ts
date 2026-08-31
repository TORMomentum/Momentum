import express from "express";

export const app = express();

app.use(express.json());

// Liveness/readiness probe — used by CI, Docker healthchecks, and the web app.
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "tor-radar-api" });
});
