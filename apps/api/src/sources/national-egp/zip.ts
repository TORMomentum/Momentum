// A small, strict ZIP reader for e-GP document packages.
//
// The package comes from a third party, so it is read as hostile input (spec decision 10): the
// entry count, each entry's size and the running total are capped from the central directory
// before anything is inflated; inflation is limited to the size the directory declared, so an
// entry that lies about its size fails instead of expanding; and every entry's CRC is checked.
// Only what e-GP actually produces is accepted — stored and deflate entries, no ZIP64, no
// encryption — and anything else is refused rather than guessed at.
//
// Sizes are read from the central directory, never the local header: e-GP writes entries with a
// data descriptor (flag bit 3), so the local header's sizes are zero.
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  /** The entry's path inside the archive, as the archive names it. */
  name: string;
  data: Buffer;
}

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const END_RECORD_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_MARKER = 0xffffffff;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8_NAME = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** The end-of-central-directory record sits in the last 22 bytes plus at most a 64 KB comment. */
function findEndRecord(buf: Buffer): number {
  const floor = Math.max(0, buf.length - END_RECORD_LENGTH - MAX_COMMENT_LENGTH);
  for (let at = buf.length - END_RECORD_LENGTH; at >= floor; at -= 1) {
    if (buf.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  return -1;
}

function inBounds(buf: Buffer, start: number, length: number): boolean {
  return start >= 0 && length >= 0 && start + length <= buf.length;
}

/** Every file entry in the archive, unpacked. Directories are skipped. */
export function readZip(buf: Buffer, limits: ZipLimits): ZipEntry[] {
  if (buf.length < END_RECORD_LENGTH) throw new ZipError("Not a ZIP archive");
  const end = findEndRecord(buf);
  if (end < 0) throw new ZipError("Not a ZIP archive");

  const entryCount = buf.readUInt16LE(end + 10);
  const directoryOffset = buf.readUInt32LE(end + 16);
  if (entryCount === 0xffff || directoryOffset === ZIP64_MARKER) {
    throw new ZipError("ZIP64 archives are not accepted");
  }
  if (entryCount > limits.maxEntries) {
    throw new ZipError(`Archive has ${entryCount} entries, over the limit of ${limits.maxEntries}`);
  }

  const entries: ZipEntry[] = [];
  let totalBytes = 0;
  let at = directoryOffset;

  for (let i = 0; i < entryCount; i += 1) {
    if (!inBounds(buf, at, 46) || buf.readUInt32LE(at) !== CENTRAL_DIRECTORY_HEADER) {
      throw new ZipError("Corrupt central directory");
    }
    const flags = buf.readUInt16LE(at + 8);
    const method = buf.readUInt16LE(at + 10);
    const expectedCrc = buf.readUInt32LE(at + 16);
    const compressedSize = buf.readUInt32LE(at + 20);
    const size = buf.readUInt32LE(at + 24);
    const nameLength = buf.readUInt16LE(at + 28);
    const extraLength = buf.readUInt16LE(at + 30);
    const commentLength = buf.readUInt16LE(at + 32);
    const localOffset = buf.readUInt32LE(at + 42);

    if (!inBounds(buf, at + 46, nameLength)) throw new ZipError("Corrupt central directory");
    const nameBytes = buf.subarray(at + 46, at + 46 + nameLength);
    const name = nameBytes.toString(flags & FLAG_UTF8_NAME ? "utf8" : "latin1");
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue;
    if (flags & FLAG_ENCRYPTED) throw new ZipError(`Entry "${name}" is encrypted`);
    if ([compressedSize, size, localOffset].includes(ZIP64_MARKER)) {
      throw new ZipError("ZIP64 archives are not accepted");
    }
    if (size > limits.maxEntryBytes) {
      throw new ZipError(`Entry "${name}" is ${size} bytes, over the limit of ${limits.maxEntryBytes}`);
    }
    totalBytes += size;
    if (totalBytes > limits.maxTotalBytes) {
      throw new ZipError(`Archive unpacks past the limit of ${limits.maxTotalBytes} bytes`);
    }

    if (!inBounds(buf, localOffset, 30) || buf.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new ZipError(`Entry "${name}" has a corrupt local header`);
    }
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (!inBounds(buf, dataStart, compressedSize)) throw new ZipError(`Entry "${name}" is truncated`);
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    let data: Buffer;
    if (method === METHOD_STORED) {
      data = Buffer.from(raw);
    } else if (method === METHOD_DEFLATE) {
      try {
        // Inflation stops at the declared size: an entry that lies about it fails here, unexpanded.
        data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw new ZipError(`Entry "${name}" does not inflate to its declared size`);
      }
    } else {
      throw new ZipError(`Entry "${name}" uses unsupported compression method ${method}`);
    }

    if (data.length !== size) throw new ZipError(`Entry "${name}" does not inflate to its declared size`);
    if (crc32(data) !== expectedCrc) throw new ZipError(`Entry "${name}" fails its CRC check`);
    entries.push({ name, data });
  }

  return entries;
}
