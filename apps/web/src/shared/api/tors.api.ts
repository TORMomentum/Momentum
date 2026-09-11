import "server-only";

interface TorDocumentResponse {
  url: string;
  expiresInSeconds: number;
  contentType: string;
  bytes: number;
}

function apiBaseUrl(): string {
  const value = process.env.API_BASE_URL;
  if (!value) throw new Error("API_BASE_URL is not configured");
  return value;
}

/** Public data access: deliberately sends no admin or intake credentials. */
export async function fetchTorDocumentUrl(id: string): Promise<string> {
  const response = await fetch(
    `${apiBaseUrl()}/api/v1/tors/${encodeURIComponent(id)}/document`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GET /tors/:id/document returned ${response.status}: ${body.slice(0, 300)}`);
  }

  const document = (await response.json()) as TorDocumentResponse;
  return document.url;
}
