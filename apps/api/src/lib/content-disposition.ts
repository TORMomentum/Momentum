/**
 * The download header for an original document (spec §5.2–5.3).
 *
 * The filename is a submitter-controlled string going into a response header,
 * so it is treated as hostile: control characters, quotes, backslashes and path
 * separators are replaced before it is used, and the non-ASCII form travels only
 * in RFC 5987 `filename*`, never raw.
 */
export type Disposition = "inline" | "attachment";

const MAX_NAME_LENGTH = 200;

export function parseDisposition(value: unknown): Disposition | null {
  if (value === undefined) return "attachment";
  return value === "inline" || value === "attachment" ? value : null;
}

function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function contentDisposition(kind: Disposition, filename: string): string {
  if (kind === "inline") return "inline";

  const safe =
    filename.replace(/[ -"\\/]/g, "_").slice(0, MAX_NAME_LENGTH) || "document";
  const asciiFallback = safe.replace(/[^\x20-\x7e]/g, "_");

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${rfc5987(safe)}`;
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

/** A fallback download name's extension, from the verified content type. */
export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType] ?? "";
}
