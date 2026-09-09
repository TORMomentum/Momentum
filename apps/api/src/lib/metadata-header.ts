/**
 * S3-compatible stores cap user-defined metadata at 2KB in total, so one value
 * gets a slice of that budget. 1024 encoded characters is roughly 113 Thai
 * characters, which covers a real announcement filename.
 */
const MAX_ENCODED_CHARS = 1024;

/**
 * Makes a client-supplied string safe to put in an `x-amz-meta-*` header.
 *
 * Two hazards, one of them ours:
 *
 * 1. The value comes from whoever uploaded the file. A carriage return or
 *    newline in a header value is header injection, so both are flattened to a
 *    space before anything else happens.
 * 2. Header values are ASCII, and these filenames are Thai, so the result is
 *    percent-encoded rather than dropped — a reader decodes it back.
 *
 * Length is trimmed on the DECODED string, never the encoded one. A Thai
 * character encodes to nine characters (`%E0%B8%9B`), so slicing the encoded
 * form cuts an escape sequence in half and leaves a value that cannot be
 * decoded at all. That is not hypothetical: the first version of this shipped
 * that way and stored `…กรมทา%8`.
 */
export function encodeMetadataValue(value: string): string {
  let plain = value.replace(/[\r\n]/g, " ");
  while (plain.length > 0 && encodeURIComponent(plain).length > MAX_ENCODED_CHARS) {
    plain = plain.slice(0, -1);
  }
  return encodeURIComponent(plain);
}
