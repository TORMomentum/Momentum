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

  it("finds a TOR whose name only contains the word TOR, but not a word that merely contains it", () => {
    const named = ["1141001044_TOR.pdf", "annoudoc_S5_69109060614.pdf", "doc_S5_69109060614.pdf"].map(entry);
    const monitor = ["monitor_spec.pdf", "Attach_TOR_2.pdf"].map(entry);

    expect(selectPackageDocuments(named, { final: true }).tor?.name).toBe("1141001044_TOR.pdf");
    expect(selectPackageDocuments(monitor, { final: true }).tor?.name).toBe("Attach_TOR_2.pdf");
  });

  it("prefers e-GP's own TOR form over attached TOR files, which are often drawings", () => {
    // A real draft package (e-GP 69109051651): Attach_TOR_1 is the construction drawings.
    const withForm = [
      "Attach_BOQ_1.pdf",
      "Attach_TOR_1.pdf",
      "Attach_TOR_2.pdf",
      "doc_A00444000064_69109051651.pdf",
      "annoudoc_A00444000064_69109051651.pdf",
      "tor_69109051651_81864484-aaa5-4eeb-8cec-595e0c339c9b.pdf",
    ].map(entry);

    expect(selectPackageDocuments(withForm, { final: false }).tor?.name).toBe("tor_69109051651_81864484-aaa5-4eeb-8cec-595e0c339c9b.pdf");
  });

  it("keeps the TOR's other parts and bills of quantities as its annexes, in reading order", () => {
    // A real package (e-GP 69109051651): the TOR form, its drawings, more parts and a bill of quantities.
    const files = [
      "Attach_BOQ_1.pdf",
      "Attach_BOQ_1.xlsx",
      "Attach_TOR_3.pdf",
      "Attach_TOR_1.pdf",
      "doc_A00444000064_69109051651.pdf",
      "annoudoc_A00444000064_69109051651.pdf",
      "tor_69109051651_81864484-aaa5-4eeb-8cec-595e0c339c9b.pdf",
    ].map(entry);

    const docs = selectPackageDocuments(files, { final: true });

    expect(docs.tor?.name).toBe("tor_69109051651_81864484-aaa5-4eeb-8cec-595e0c339c9b.pdf");
    expect(docs.annexes.map((e) => e.name)).toEqual(["Attach_TOR_1.pdf", "Attach_TOR_3.pdf", "Attach_BOQ_1.pdf"]);
  });

  it("takes the one agency-uploaded PDF as the TOR when nothing is named TOR", () => {
    // A real draft package (e-GP 69109068322): the agency's scan plus e-GP's generated files.
    const scanned = ["Scan_0004.pdf", "doc_00122560012000000_69109068322.pdf", "annoudoc_00122560012000000_69109068322.pdf"].map(entry);

    expect(selectPackageDocuments(scanned, { final: false }).tor?.name).toBe("Scan_0004.pdf");
  });

  it("does not guess between two agency-uploaded PDFs", () => {
    const two = ["Scan_0004.pdf", "Scan_0005.pdf", "annoudoc_x_1.pdf", "Bid Bond.pdf", "pB0.pdf"].map(entry);

    expect(selectPackageDocuments(two, { final: true }).tor).toBeUndefined();
  });

  it("never takes a draft package's announcement as the invitation", () => {
    // A draft announcement carries draft dates; linking its deadline onto the TOR would mislead.
    const docs = selectPackageDocuments(finalPackage, { final: false });

    expect(docs.tor?.name).toBe("TOR(1).pdf");
    expect(docs.invitation).toBeUndefined();
  });

  it("finds nothing in a package with neither a TOR nor an announcement", () => {
    expect(selectPackageDocuments(["quotation.pdf", "contract_01.pdf"].map(entry), { final: true })).toEqual({ annexes: [] });
  });

  it("matches on the file name, not the folder it sits in", () => {
    const nested = [entry("tor-files/quotation.pdf"), entry("x/Attach_TOR_1.pdf")];

    const docs = selectPackageDocuments(nested, { final: true });
    expect(docs.tor?.name).toBe("x/Attach_TOR_1.pdf");
    expect(entryFilename(docs.tor!)).toBe("Attach_TOR_1.pdf");
  });
});
