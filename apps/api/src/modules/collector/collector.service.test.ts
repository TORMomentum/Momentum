import "../../test/env.js";

import { describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../../core/config.js";
import type { EgpCollectSource, EgpListKind } from "../../ports/egp-collect.port.js";
import type { Storage } from "../../ports/storage.port.js";
import type { ListItem } from "../../sources/national-egp/announcements.js";
import { crc32 } from "../../sources/national-egp/zip.js";
import type { SubmitSource } from "../intake/intake.service.js";
import type { AwardTarget, CollectorRepository } from "./collector.repository.js";
import { COLLECTOR_SUBMITTER, CollectorService, FAILURES_BEFORE_BACKOFF, partOutcome } from "./collector.service.js";

const base = loadConfig(process.env);
const config = (collector: Partial<Config["collector"]> = {}): Config => ({
  ...base,
  collector: { ...base.collector, enabled: true, requestDelayMs: 0, listPages: 1, maxNewPerDay: 50, ...collector },
});

/** A ZIP of stored (uncompressed) entries, as e-GP's packages are read: central directory and all. */
function storedZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const PACKAGE = storedZip({ "TOR(1).pdf": "%PDF tor", "annoudoc_1_69110000001.pdf": "%PDF invitation" });

const row = (projectId: string): ListItem => ({ projectId, title: `โครงการ ${projectId}`, agency: "กรมตัวอย่าง", announcedOn: "2026-11-20" });

interface FakeOptions {
  lists?: Partial<Record<EgpListKind, ListItem[]>>;
  listDown?: boolean;
  refuseProjects?: boolean;
  held?: Record<string, EgpListKind[]>;
  awards?: AwardTarget[];
  createdToday?: number;
  duplicates?: boolean;
}

function harness(options: FakeOptions = {}, settings: Partial<Config["collector"]> = {}) {
  const asked: string[] = [];
  const submitted: SubmitSource[] = [];
  const source: EgpCollectSource = {
    async announcementList(kind, page) {
      asked.push(`list:${kind}:${page}`);
      if (options.listDown) throw new Error("Source responded with status 503");
      return page === 1 ? (options.lists?.[kind] ?? []) : [];
    },
    async bidPackage(projectId) {
      asked.push(`package:${projectId}`);
      if (options.refuseProjects) throw new Error("Source responded with status 429");
      return { fileId: `f${projectId}`, name: `${projectId}.zip` };
    },
    async downloadPackage() {
      return PACKAGE;
    },
    packageUrl: (fileId) => `https://egp.example/${fileId}`,
    async torAnnouncedOn() {
      return "2026-11-18";
    },
    async awardTemplateId(projectId) {
      asked.push(`award:${projectId}`);
      return `t${projectId}`;
    },
    async downloadAward() {
      return Buffer.from("%PDF award");
    },
    awardPdfUrl: (templateId) => `https://egp.example/award/${templateId}`,
  };
  const repo = {
    async collectedElsewhere() {
      return null;
    },
    async holds(projectId: string, kind: EgpListKind) {
      return options.held?.[projectId]?.includes(kind) ?? false;
    },
    async createdSince() {
      return options.createdToday ?? 0;
    },
    async awardTargets(limit: number) {
      return (options.awards ?? []).slice(0, limit);
    },
  } as unknown as CollectorRepository;
  const intake = {
    async submit(_bytes: Buffer, submission: SubmitSource) {
      submitted.push(submission);
      return { torId: `r${submitted.length}`, duplicate: options.duplicates ?? false, state: "queued" as const };
    },
  };
  const storage = {
    async putIfAbsent(key: string) {
      return { bucket: "raw", key, contentType: "application/zip", bytes: 1 };
    },
  } as unknown as Storage;
  const service = new CollectorService({ source, repo, intake, storage, config: config(settings) });
  return { service, asked, submitted };
}

describe("CollectorService.runPass (spec 2026-11-25-scheduled-collector)", () => {
  it("reads the invitation list, then the draft-TOR list, then winner announcements, as the collector", async () => {
    const { service, asked, submitted } = harness({
      lists: { invitation: [row("69110000001")], tor: [row("69110000002")] },
      awards: [{ projectId: "69110000003", announcedOn: "2026-11-21" }],
    });
    const pass = await service.runPass();

    expect(asked.filter((step) => step.startsWith("list"))).toEqual(["list:invitation:1", "list:tor:1"]);
    // Invitation list: TOR and invitation. Draft-TOR list: the TOR only. Then the award.
    expect(submitted.map((s) => `${s.context?.sourceProject?.projectId}:${s.context?.documentType}`)).toEqual([
      "69110000001:tor",
      "69110000001:invitation",
      "69110000002:tor",
      "69110000003:award",
    ]);
    expect(submitted.every((s) => s.submittedBy === COLLECTOR_SUBMITTER)).toBe(true);
    expect(pass.tors).toEqual({ asked: true, projects: 2, queued: 3, failed: 0, error: null });
    expect(pass.awards).toEqual({ asked: true, projects: 1, queued: 1, failed: 0, error: null });
    expect(pass.remaining).toBe(46);
  });

  it("downloads nothing for a project whose document it already holds (decision 5)", async () => {
    const { service, asked } = harness({
      lists: { invitation: [row("69110000001")], tor: [row("69110000001"), row("69110000002")] },
      held: { "69110000001": ["invitation", "tor"] },
    });
    const pass = await service.runPass();

    expect(asked.filter((step) => step.startsWith("package"))).toEqual(["package:69110000002"]);
    expect(pass.tors.projects).toBe(1);
  });

  it("stops queuing at the daily ceiling, counting what the last 24 hours already queued (decision 6)", async () => {
    const { service, submitted } = harness(
      { lists: { invitation: [row("69110000001"), row("69110000002"), row("69110000003")] }, createdToday: 8 },
      { maxNewPerDay: 10 },
    );
    const pass = await service.runPass();

    // Two left: the first project's TOR and invitation spend them, and nothing more is read.
    expect(submitted).toHaveLength(2);
    expect(pass.remaining).toBe(0);
    expect(pass.awards.projects).toBe(0);
  });

  it("never passes the ceiling inside a project: the invitation waits when the TOR spends the last one", async () => {
    const { service, submitted } = harness(
      { lists: { invitation: [row("69110000001"), row("69110000002")] }, createdToday: 7 },
      { maxNewPerDay: 10 },
    );
    const pass = await service.runPass();

    expect(submitted.map((s) => `${s.context?.sourceProject?.projectId}:${s.context?.documentType}`)).toEqual([
      "69110000001:tor",
      "69110000001:invitation",
      "69110000002:tor",
    ]);
    expect(pass.remaining).toBe(0);
  });

  it("does not count a document linked onto a record already stored", async () => {
    const { service } = harness({ lists: { invitation: [row("69110000001")] }, duplicates: true }, { maxNewPerDay: 1 });
    const pass = await service.runPass();

    expect(pass.tors.queued).toBe(0);
    expect(pass.remaining).toBe(1);
  });

  it("asks e-GP nothing once the ceiling is spent", async () => {
    const { service, asked } = harness({ lists: { invitation: [row("69110000001")] }, createdToday: 50 });
    const pass = await service.runPass();

    expect(asked).toEqual([]);
    expect(partOutcome(pass.tors)).toBeNull();
  });

  it("backs off after three projects in a row fail, and reports the part as failed (decision 8)", async () => {
    const rows = ["69110000001", "69110000002", "69110000003", "69110000004"].map(row);
    const { service, asked } = harness({ lists: { invitation: rows }, refuseProjects: true, awards: [{ projectId: "69110000009", announcedOn: null }] });
    const pass = await service.runPass();

    expect(pass.backOff).toBe(true);
    expect(pass.tors.failed).toBe(FAILURES_BEFORE_BACKOFF);
    expect(asked.some((step) => step.startsWith("award"))).toBe(false);
    expect(partOutcome(pass.tors)).toMatchObject({ ok: false, items: 3, failed: 3 });
  });

  it("records an unreadable list as a failed run, and still collects announcements", async () => {
    const { service } = harness({ listDown: true, awards: [{ projectId: "69110000003", announcedOn: "2026-11-21" }] });
    const pass = await service.runPass();

    expect(partOutcome(pass.tors)).toMatchObject({ ok: false, items: 0, error: expect.stringContaining("list unavailable") });
    expect(partOutcome(pass.awards)).toEqual({ ok: true, items: 1, failed: 0, error: null });
  });
});

describe("CollectorService.importProject", () => {
  it("dates the TOR from the list it came from, and the invitation from the invitation list", async () => {
    const { service, submitted } = harness();
    const fromTors = await service.importProject({ projectId: "69110000001", from: "tor-list", row: row("69110000001") }, "tool");
    const fromInvitations = await service.importProject({ projectId: "69110000002", from: "invitation-list", row: row("69110000002") }, "tool");

    expect(fromTors.documents.map((doc) => doc.documentType)).toEqual(["tor"]);
    expect(fromInvitations.documents.map((doc) => doc.documentType)).toEqual(["tor", "invitation"]);
    const [draftTor, tor, invitation] = submitted;
    expect(draftTor?.context?.announcedAt).toEqual(new Date("2026-11-20T00:00:00Z"));
    // From the invitation list the TOR's own day comes from the project's stage table.
    expect(tor?.context?.announcedAt).toEqual(new Date("2026-11-18T00:00:00Z"));
    expect(invitation?.context?.announcedAt).toEqual(new Date("2026-11-20T00:00:00Z"));
    expect(submitted.every((s) => s.submittedBy === "tool" && s.url?.startsWith("https://egp.example/"))).toBe(true);
  });
});

describe("partOutcome", () => {
  it("is nothing when e-GP was not asked, a success while any project worked, and a failure otherwise", () => {
    expect(partOutcome({ asked: false, projects: 0, queued: 0, failed: 0, error: null })).toBeNull();
    // The list was read and held nothing new: e-GP answered, so the source is working.
    expect(partOutcome({ asked: true, projects: 0, queued: 0, failed: 0, error: null })).toEqual({ ok: true, items: 0, failed: 0, error: null });
    expect(partOutcome({ asked: true, projects: 4, queued: 3, failed: 1, error: null })).toEqual({ ok: true, items: 4, failed: 1, error: null });
    expect(partOutcome({ asked: true, projects: 2, queued: 0, failed: 2, error: null })).toEqual({ ok: false, items: 2, failed: 2, error: "every project failed" });
  });
});
