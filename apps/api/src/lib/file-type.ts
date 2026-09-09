/** Signatures for the three formats FR-A-1 accepts. */
const SIGNATURES: ReadonlyArray<{ mime: string; bytes: number[] }> = [
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/**
 * Identifies a document by its leading bytes. Returns null when the content does
 * not match an accepted format, whatever the caller claimed it was.
 */
export function detectMimeType(bytes: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (bytes.length < signature.bytes.length) continue;
    const matches = signature.bytes.every((byte, index) => bytes[index] === byte);
    if (matches) return signature.mime;
  }
  return null;
}
