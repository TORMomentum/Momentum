import { app } from "./app";

const port = Number(process.env.API_PORT ?? 4000);
// Bind all interfaces so the container port mapping reaches it.
const host = process.env.API_HOST ?? "0.0.0.0";

app.listen(port, host, () => {
  console.log(`tor-radar-api listening on ${host}:${port}`);
});
