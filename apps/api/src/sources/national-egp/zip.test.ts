import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, readZip, ZipError } from "./zip.js";

interface FixtureEntry {
  name: string;
  data: Buffer;
  method?: 0 | 8;
  flags?: number;
  /** Overrides the size the central directory declares, to forge a lying entry. */
  declaredSize?: number;
}

/**
 * Writes a ZIP the way e-GP does: data-descriptor flag set and zero sizes in the
 * local header, so only the central directory says how big an entry is.
 */
function buildZip(entries: FixtureEntry[]): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 8;
    const flags = (entry.flags ?? 0) | 0x0008;
    const name = Buffer.from(entry.name, "utf8");
    const body = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.declaredSize ?? entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directoryBytes, end]);
}

const roomy = { maxEntries: 50, maxEntryBytes: 1_000_000, maxTotalBytes: 5_000_000 };
const pdf = Buffer.from("%PDF-1.7\n" + "ประกาศเชิญชวน ".repeat(200));

describe("readZip", () => {
  it("unpacks deflated and stored entries whose sizes live only in the central directory", () => {
    const zip = buildZip([
      { name: "TOR(1).pdf", data: pdf },
      { name: "annoudoc_0700300196_69099218130.pdf", data: Buffer.from("%PDF-stored"), method: 0 },
    ]);

    const entries = readZip(zip, roomy);

    expect(entries.map((e) => e.name)).toEqual(["TOR(1).pdf", "annoudoc_0700300196_69099218130.pdf"]);
    expect(entries[0].data.equals(pdf)).toBe(true);
    expect(entries[1].data.toString()).toBe("%PDF-stored");
  });

  it("decodes a UTF-8 flagged name as UTF-8", () => {
    const zip = buildZip([{ name: "ขอบเขตงาน.pdf", data: pdf, flags: 0x0800 }]);

    expect(readZip(zip, roomy)[0].name).toBe("ขอบเขตงาน.pdf");
  });

  it("skips directory entries", () => {
    const zip = buildZip([
      { name: "docs/", data: Buffer.alloc(0), method: 0 },
      { name: "docs/TOR.pdf", data: pdf },
    ]);

    expect(readZip(zip, roomy).map((e) => e.name)).toEqual(["docs/TOR.pdf"]);
  });

  it("refuses an archive with more entries than allowed, before unpacking any", () => {
    const zip = buildZip([{ name: "a.pdf", data: pdf }, { name: "b.pdf", data: pdf }]);

    expect(() => readZip(zip, { ...roomy, maxEntries: 1 })).toThrow(/over the limit of 1/);
  });

  it("refuses an entry declared larger than the per-entry cap", () => {
    const zip = buildZip([{ name: "big.pdf", data: pdf }]);

    expect(() => readZip(zip, { ...roomy, maxEntryBytes: 100 })).toThrow(/over the limit of 100/);
  });

  it("refuses an archive whose entries together unpack past the total cap", () => {
    const zip = buildZip([{ name: "a.pdf", data: pdf }, { name: "b.pdf", data: pdf }]);

    expect(() => readZip(zip, { ...roomy, maxTotalBytes: pdf.length + 1 })).toThrow(/unpacks past the limit/);
  });

  it("stops a bomb that declares a small size and inflates to a large one", () => {
    const zip = buildZip([{ name: "bomb.pdf", data: Buffer.alloc(500_000), declaredSize: 10 }]);

    expect(() => readZip(zip, roomy)).toThrow(/does not inflate to its declared size/);
  });

  it("refuses an entry whose bytes do not match its CRC", () => {
    const zip = buildZip([{ name: "TOR.pdf", data: pdf, method: 0 }]);
    const tampered = Buffer.from(zip);
    tampered[30 + "TOR.pdf".length + 20] ^= 0xff;

    expect(() => readZip(tampered, roomy)).toThrow(/fails its CRC check/);
  });

  it("refuses encrypted entries", () => {
    const zip = buildZip([{ name: "secret.pdf", data: pdf, flags: 0x0001 }]);

    expect(() => readZip(zip, roomy)).toThrow(/encrypted/);
  });

  it("refuses bytes that are not a ZIP archive", () => {
    expect(() => readZip(pdf, roomy)).toThrow(ZipError);
    expect(() => readZip(Buffer.alloc(4), roomy)).toThrow(ZipError);
  });
});
