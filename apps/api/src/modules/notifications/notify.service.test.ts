import "../../test/env.js";
import { ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import type { ProjectStageEntry } from "@tor-radar/shared";
import { accounts, bookmarks, connect, disconnect, ensureIndexes, notificationLeases, notifications, torClassifications, torEvents, tors, vendorProfiles } from "../../core/db.js";
import type { Mailer } from "../../ports/mailer.port.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { NotifyService } from "./notify.service.js";

const base = loadConfig(process.env);
let db: Db;
let deliveries: Array<{ to: string; text: string; subject?: string }>;
const mailer: Mailer = { send: async (message) => { deliveries.push({ to: message.to, text: message.text, subject: message.subject }); return { messageId: `test-${deliveries.length}` }; } };
const future = "2099-01-01";

async function vendor(overrides: Partial<{ verified: boolean; disabled: boolean; deleted: boolean; withdrawn: boolean; minMatch: number; preset: "all" | "daily" | "high" | "off"; reminder: boolean; noNotify: boolean; leadDays: number }> = {}) {
  const id = new ObjectId();
  await accounts(db).insertOne({ _id: id, email: `${id}@example.test`, displayName: "ผู้ขายทดสอบ", role: "vendor", consent: { noticeVersion: "test", noticeHash: "test", agreedAt: new Date(), action: "checkbox", ...(overrides.withdrawn ? { withdrawnAt: new Date() } : {}) }, ...(overrides.verified === false ? {} : { emailVerifiedAt: new Date() }), ...(overrides.disabled ? { disabledAt: new Date() } : {}), ...(overrides.deleted ? { deletedAt: new Date() } : {}), createdAt: new Date(), updatedAt: new Date() });
  await vendorProfiles(db).insertOne({ accountId: id.toString(), categories: ["it.software"], areas: [], budget: null, ...(overrides.noNotify ? {} : { notify: { preset: overrides.preset ?? "all", minMatch: overrides.minMatch ?? 50, leadDays: overrides.leadDays ?? 7, deadlineReminder: overrides.reminder ?? false, anomalyAlert: false } }), taxonomyVersion: "test", updatedAt: new Date() });
  return id.toString();
}

async function tor(overrides: Partial<{ deadline: string; restricted: boolean; status: "announced" | "closed" | "awarded" | "cancelled"; stageKind: "awarded" | "cancelled" }> = {}) {
  const now = new Date();
  return (await tors(db).insertOne({ contentHash: new ObjectId().toHexString(), storage: { bucket: "test", key: "test", contentType: "application/pdf", bytes: 1 }, sourceRefs: [], pipeline: { state: "published", attempts: 1 }, fields: { referenceNo: { raw: "TOR-TEST", value: "TOR-TEST", confidence: 1, verified: true }, title: { raw: "จ้างพัฒนาระบบสารสนเทศและเว็บไซต์", value: "จ้างพัฒนาระบบสารสนเทศและเว็บไซต์", confidence: 1, verified: true }, agency: { raw: "หน่วยงานทดสอบ", value: "หน่วยงานทดสอบ", confidence: 1, verified: true }, budget: { raw: "100", value: 100, confidence: 1, verified: true }, deadline: { raw: overrides.deadline ?? future, value: overrides.deadline ?? future, confidence: 1, verified: true }, torStatus: { raw: overrides.status ?? "announced", value: overrides.status ?? "announced", confidence: 1, verified: true } }, ...(overrides.stageKind ? { stage: { code: "X", kind: overrides.stageKind, on: "2026-10-01" } } : {}), announcedAt: now, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: overrides.restricted ?? false }, duplicateOf: null, createdAt: now, updatedAt: now })).insertedId.toString();
}

function service(enabled: boolean, extra: Partial<typeof base.notifications> = {}) { return new NotifyService(db, { ...base, notifications: { ...base.notifications, dispatchEnabled: enabled, ...extra } }, mailer, () => new Date("2026-10-07T06:00:00.000Z")); }

beforeAll(async () => { db = await connect(isolatedDbUrl(base.mongoUrl, "notify-service")); await ensureIndexes(db); });
beforeEach(async () => { deliveries = []; await Promise.all([accounts(db).deleteMany({}), bookmarks(db).deleteMany({}), vendorProfiles(db).deleteMany({}), tors(db).deleteMany({}), torClassifications(db).deleteMany({}), notifications(db).deleteMany({}), notificationLeases(db).deleteMany({}), torEvents(db).deleteMany({})]); });
afterAll(async () => { await disconnect(); });

describe("NotifyService", () => {
  it("sends nothing at all — reminders included — to a vendor who chose off", async () => {
    // Every notification email has to offer a way out, and before "off" there
    // was none short of withdrawing consent entirely.
    const id = await vendor({ preset: "off", reminder: true, leadDays: 30 });
    const saved = await tor({ deadline: "2026-10-10" });
    await bookmarks(db).insertOne({ accountId: id, torId: saved, createdAt: new Date() } as never);
    await tor();

    await service(true).dispatch();

    expect(deliveries).toHaveLength(0);
    expect(await notifications(db).countDocuments({ accountId: id })).toBe(0);
  });

  it("emails a vendor whose profile predates preferences, on the default their profile shows", async () => {
    // Absent preferences used to mean "never email", while the same vendor's
    // profile page showed the daily digest as chosen.
    await vendor({ noNotify: true });
    await tor();

    await service(true).dispatch();

    expect(deliveries).toHaveLength(1);
  });

  it("links the email to pages that exist", async () => {
    // It pointed at /settings/notifications, which has never existed, so every
    // settings and unsubscribe link in every email was a 404.
    await vendor(); await tor();
    await service(true).dispatch();
    expect(deliveries[0].text).not.toContain("/settings/notifications");
    expect(deliveries[0].text).toContain("/profile");
  });

  it("records dry runs without calling the mailer, then sends a real notification only once", async () => {
    await vendor(); await tor();
    await service(false).dispatch();
    expect(deliveries).toHaveLength(0); expect(await notifications(db).countDocuments({ dryRun: true, reason: "match" })).toBe(1);
    await service(true).dispatch(); await service(true).dispatch();
    expect(deliveries).toHaveLength(1); expect(await notifications(db).countDocuments({ dryRun: false, reason: "match" })).toBe(1);
    expect(deliveries[0].text).toContain("จ้างพัฒนาระบบสารสนเทศและเว็บไซต์"); expect(deliveries[0].text).toContain("ตรงกับหมวดงานที่คุณเลือก");
  });

  it("uses unique claims to make concurrent dispatches send at most once", async () => {
    await vendor(); await tor(); await Promise.all([service(true).dispatch(), service(true).dispatch()]);
    expect(deliveries).toHaveLength(1);
  });

  it("skips ineligible accounts and a score below the vendor threshold", async () => {
    await Promise.all([vendor({ verified: false }), vendor({ disabled: true }), vendor({ deleted: true }), vendor({ withdrawn: true }), vendor({ minMatch: 95 })]); await tor();
    await service(true).dispatch();
    expect(deliveries).toHaveLength(0); expect(await notifications(db).countDocuments()).toBe(0);
  });

  it("sends at most one daily digest within its configured day boundary", async () => {
    await vendor({ preset: "daily" }); await tor(); await service(true).dispatch(); await tor(); await service(true).dispatch();
    expect(deliveries).toHaveLength(1);
  });

  it("sends one reminder for an open bookmarked TOR inside leadDays, never for restricted TORs", async () => {
    const accountId = await vendor({ reminder: true, leadDays: 3 });
    const date = "2026-10-09"; const openId = await tor({ deadline: date }); const restrictedId = await tor({ deadline: date, restricted: true }); const closedId = await tor({ deadline: date, status: "closed" });
    await bookmarks(db).insertMany([{ accountId, torId: openId, createdAt: new Date() }, { accountId, torId: restrictedId, createdAt: new Date() }, { accountId, torId: closedId, createdAt: new Date() }]);
    await service(true).dispatch(); await service(true).dispatch();
    expect(await notifications(db).countDocuments({ reason: "deadline-reminder" })).toBe(1);
  });

  describe("sendMatchesNow (admin-triggered)", () => {
    it("emails the vendor their open matches even while automatic sending is off, and claims nothing", async () => {
      // A final stage from the source closes a TOR extraction still reads as announced (TOR-205).
      const id = await vendor(); await tor(); await tor({ status: "awarded" }); await tor({ stageKind: "cancelled" });
      const result = await service(false).sendMatchesNow(id);
      expect(result.sent).toBe(1);
      expect(deliveries).toHaveLength(1);
      // The automatic digest must still be free to include it later.
      expect(await notifications(db).countDocuments()).toBe(0);
    });

    it("refuses a vendor who turned email off — an admin cannot override that", async () => {
      const id = await vendor({ preset: "off" }); await tor();
      await expect(service(false).sendMatchesNow(id)).rejects.toThrow("ปิดการแจ้งเตือน");
      expect(deliveries).toHaveLength(0);
    });

    it("refuses an account the automatic sender would skip", async () => {
      for (const id of await Promise.all([vendor({ verified: false }), vendor({ disabled: true }), vendor({ withdrawn: true })])) {
        await expect(service(false).sendMatchesNow(id)).rejects.toThrow();
      }
      expect(deliveries).toHaveLength(0);
    });

    it("sends nothing, and says so, when nothing open matches", async () => {
      const id = await vendor({ minMatch: 95 }); await tor();
      expect(await service(false).sendMatchesNow(id)).toEqual({ sent: 0 });
      expect(deliveries).toHaveLength(0);
    });
  });

  describe("project stages (TOR-207)", () => {
    const NOW = new Date("2026-10-07T06:00:00.000Z");
    const DRAFT: ProjectStageEntry = { code: "B0", kind: "draft", description: "ร่างเอกสารประกวดราคา(e-Bidding)", on: "2026-10-01" };
    const INVITED: ProjectStageEntry = { code: "D0", kind: "invitation", description: "ประกาศเชิญชวน", on: "2026-10-07" };
    const AWARDED: ProjectStageEntry = { code: "W0", kind: "awarded", description: "ประกาศรายชื่อผู้ชนะการเสนอราคา", on: "2026-10-07" };
    const CONTRACT: ProjectStageEntry = { code: "I0", kind: "awarded", description: "ข้อมูลสาระสำคัญในสัญญา", on: "2026-10-07" };
    const PRICE: ProjectStageEntry = { code: "BOQ", kind: "median-price", description: null, on: "2026-10-07" };

    async function stages(torId: string, history: ProjectStageEntry[]) {
      const latest = history.at(-1)!;
      await tors(db).updateOne({ _id: new ObjectId(torId) }, { $set: { stageHistory: history, stage: { code: latest.code, kind: latest.kind, on: latest.on } } });
    }
    async function move(torId: string, from: string | null, to: string, at = new Date(NOW.getTime() + 3_600_000)) {
      await torEvents(db).insertOne({ torId, kind: "stage", from, to, at, actor: "stages-worker", source: "national-egp" });
    }
    const later = (hours: number) => new NotifyService(db, { ...base, notifications: { ...base.notifications, dispatchEnabled: true } }, mailer, () => new Date(NOW.getTime() + hours * 3_600_000));

    it("tells a vendor met at the draft stage that bids are not open yet (TOR-238)", async () => {
      await vendor();
      const draft = await tor({ deadline: undefined });
      await tors(db).updateOne({ _id: new ObjectId(draft) }, { $set: { "fields.deadline.value": null } });
      await stages(draft, [DRAFT]);

      await service(true).dispatch();

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.text).toContain("ขั้นร่าง TOR · ยังไม่เปิดยื่นข้อเสนอ — มีเวลาเตรียมตัว");
    });

    it("emails a matched vendor once when the invitation is out, with the deadline; never again for that move", async () => {
      await vendor();
      const id = await tor();
      await stages(id, [DRAFT]);
      await service(true).dispatch();
      expect(deliveries).toHaveLength(1);

      await stages(id, [DRAFT, INVITED]);
      await move(id, "B0", "D0");
      await later(2).dispatch();
      await later(3).dispatch();

      expect(deliveries).toHaveLength(2);
      expect(deliveries[1]!.subject).toBe("อัปเดตโครงการที่คุณติดตาม: ประกาศเชิญชวนแล้ว");
      expect(deliveries[1]!.text).toContain("คุณได้รับแจ้งโครงการนี้เพราะตรงกับโปรไฟล์ของคุณ");
      expect(deliveries[1]!.text).toContain("ขั้นตอนล่าสุด: ประกาศเชิญชวน · 7 ต.ค. 2569");
      expect(deliveries[1]!.text).toContain("ยื่นภายใน 1 ม.ค. 2642");
      expect(await notifications(db).countDocuments({ reason: "stage-change", sentAt: { $exists: true } })).toBe(1);
    });

    it("emails a vendor who saved a TOR when a winner is announced, and not again for the contract after it", async () => {
      const id = await vendor({ minMatch: 100 });
      const saved = await tor();
      await bookmarks(db).insertOne({ accountId: id, torId: saved, createdAt: NOW } as never);
      await stages(saved, [INVITED, AWARDED]);
      await move(saved, "D0", "W0");
      await later(2).dispatch();
      await stages(saved, [INVITED, AWARDED, CONTRACT]);
      await move(saved, "W0", "I0", new Date(NOW.getTime() + 4 * 3_600_000));
      await later(5).dispatch();

      expect(deliveries.map((delivery) => delivery.subject)).toEqual(["อัปเดตโครงการที่คุณติดตาม: ประกาศผู้ชนะแล้ว"]);
      expect(deliveries[0]!.text).toContain("คุณบันทึกโครงการนี้ไว้");
    });

    it("sends nothing for a first read, a median-price stage, a move before following, an old move, a vendor who chose off, or in a dry run", async () => {
      const followed = await vendor({ minMatch: 100 });
      const off = await vendor({ preset: "off", minMatch: 100 });
      const first = await tor(); const price = await tor(); const before = await tor(); const old = await tor();
      for (const torId of [first, price, before, old]) {
        for (const accountId of [followed, off]) await bookmarks(db).insertOne({ accountId, torId, createdAt: NOW } as never);
      }
      await stages(first, [INVITED]); await move(first, null, "D0");
      await stages(price, [DRAFT, PRICE]); await move(price, "B0", "BOQ");
      await stages(before, [DRAFT, INVITED]); await move(before, "B0", "D0", new Date(NOW.getTime() - 3_600_000));
      await stages(old, [DRAFT, INVITED]);
      await bookmarks(db).updateMany({ torId: old }, { $set: { createdAt: new Date("2026-08-01T00:00:00Z") } });
      await move(old, "B0", "D0", new Date("2026-09-01T00:00:00Z"));

      await later(2).dispatch();
      expect(deliveries).toHaveLength(0);

      const fresh = await tor();
      await bookmarks(db).insertOne({ accountId: followed, torId: fresh, createdAt: NOW } as never);
      await stages(fresh, [DRAFT, INVITED]); await move(fresh, "B0", "D0");
      await new NotifyService(db, { ...base, notifications: { ...base.notifications, dispatchEnabled: false } }, mailer, () => new Date(NOW.getTime() + 2 * 3_600_000)).dispatch();
      expect(deliveries).toHaveLength(0);
      expect(await notifications(db).countDocuments({ reason: "stage-change", dryRun: true, accountId: followed })).toBe(1);
      expect(await notifications(db).countDocuments({ reason: "stage-change", accountId: off })).toBe(0);
    });
  });
});
