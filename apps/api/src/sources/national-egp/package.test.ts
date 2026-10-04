import { describe, expect, it } from "vitest";
import { entryFilename, selectPackageDocuments } from "./package.js";

const entry = (name: string) => ({ name, data: Buffer.from(name) });

// File names as they appear in real packages (e-GP 69099218130 and 68039469567).
const finalPackage = [
  "quotation.pdf",
  "Bid Bond.pdf",
  "bidding noltice.pdf",
  "action_plan.xlsx",
  "Attach_PUB_1.pdf",
  "contract_01.pdf",
  "TOR(1).pdf",
  "Attach_TOR_2.pdf",
  "Attach_TOR_3.pdf",
  "doc_0700300196_69099218130.pdf",
  "annoudoc_0700300196_69099218130.pdf",
].map(entry);

describe("selectPackageDocuments", () => {
  it("takes the file named TOR as the primary TOR and annoudoc as the invitation", () => {
    const docs = selectPackageDocuments(finalPackage, { final: true });

    expect(docs.tor?.name).toBe("TOR(1).pdf");
    expect(docs.invitation?.name).toBe("annoudoc_0700300196_69099218130.pdf");
  });

  it("falls back to the lowest-numbered Attach_TOR when no file is named TOR", () => {
    const older = ["Attach_TOR_3.pdf", "Attach_TOR_1.pdf", "Attach_TOR_10.pdf", "doc_x.pdf"].map(entry);

    expect(selectPackageDocuments(older, { final: true }).tor?.name).toBe("Attach_TOR_1.pdf");
  });

  it("never takes a draft package's announcement as the invitation", () => {
    // A draft announcement carries draft dates; linking its deadline onto the TOR would mislead.
    const docs = selectPackageDocuments(finalPackage, { final: false });

    expect(docs.tor?.name).toBe("TOR(1).pdf");
    expect(docs.invitation).toBeUndefined();
  });

  it("finds nothing in a package with neither a TOR nor an announcement", () => {
    expect(selectPackageDocuments(["quotation.pdf", "contract_01.pdf"].map(entry), { final: true })).toEqual({});
  });

  it("matches on the file name, not the folder it sits in", () => {
    const nested = [entry("tor-files/quotation.pdf"), entry("x/Attach_TOR_1.pdf")];

    const docs = selectPackageDocuments(nested, { final: true });
    expect(docs.tor?.name).toBe("x/Attach_TOR_1.pdf");
    expect(entryFilename(docs.tor!)).toBe("Attach_TOR_1.pdf");
  });
});
