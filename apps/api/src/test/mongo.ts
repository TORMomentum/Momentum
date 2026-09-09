/**
 * Integration tests share one Mongo instance. Files that touch the same
 * collections (a test using `tors` and another using `tors`) race each other
 * under vitest's default file parallelism. Each such file connects to its own
 * database instead, derived from the configured URL.
 */
export function isolatedDbUrl(baseUrl: string, suffix: string): string {
  const url = new URL(baseUrl);
  const base = url.pathname.replace(/^\//, "").split("/")[0] || "tor_radar";
  url.pathname = `/${base}_${suffix}`;
  return url.toString();
}
