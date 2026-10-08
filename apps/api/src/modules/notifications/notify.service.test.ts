import "../../test/env.js";
import { ObjectId, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../core/config.js";
import { accounts, bookmarks, connect, disconnect, ensureIndexes, notificationLeases, notifications, torClassifications, tors, vendorProfiles } from "../../core/db.js";
import type { Mailer } from "../../ports/mailer.port.js";
import { isolatedDbUrl } from "../../test/mongo.js";
import { NotifyService } from "./notify.service.js";

const base = loadConfig(process.env);
let db: Db;
let deliveries: Array<{ to: string; text: string }>;
const mailer: Mailer = { send: async (message) => { deliveries.push({ to: message.to, text: message.text }); return { messageId: `test-${deliveries.length}` }; } };
const future = "2099-01-01";

async function vendor(overrides: Partial<{ verified: boolean; disabled: boolean; deleted: boolean; withdrawn: boolean; minMatch: number; preset: "all" | "daily" | "high" | "off"; reminder: boolean; noNotify: boolean; leadDays: number }> = {}) {
  const id = new ObjectId();
  await accounts(db).insertOne({ _id: id, email: `${id}@example.test`, displayName: "ผู้ขายทดสอบ", role: "vendor", consent: { noticeVersion: "test", noticeHash: "test", agreedAt: new Date(), action: "checkbox", ...(overrides.withdrawn ? { withdrawnAt: new Date() } : {}) }, ...(overrides.verified === false ? {} : { emailVerifiedAt: new Date() }), ...(overrides.disabled ? { disabledAt: new Date() } : {}), ...(overrides.deleted ? { deletedAt: new Date() } : {}), createdAt: new Date(), updatedAt: new Date() });
  await vendorProfiles(db).insertOne({ accountId: id.toString(), categories: ["it.software"], areas: [], budget: null, ...(overrides.noNotify ? {} : { notify: { preset: overrides.preset ?? "all", minMatch: overrides.minMatch ?? 50, leadDays: overrides.leadDays ?? 7, deadlineReminder: overrides.reminder ?? false, anomalyAlert: false } }), taxonomyVersion: "test", updatedAt: new Date() });
  return id.toString();
}

async function tor(overrides: Partial<{ deadline: string; restricted: boolean; status: "announced" | "closed" | "awarded" | "cancelled" }> = {}) {
  const now = new Date();
  return (await tors(db).insertOne({ contentHash: new ObjectId().toHexString(), storage: { bucket: "test", key: "test", contentType: "application/pdf", bytes: 1 }, sourceRefs: [], pipeline: { state: "published", attempts: 1 }, fields: { referenceNo: { raw: "TOR-TEST", value: "TOR-TEST", confidence: 1, verified: true }, title: { raw: "จ้างพัฒนาระบบสารสนเทศและเว็บไซต์", value: "จ้างพัฒนาระบบสารสนเทศและเว็บไซต์", confidence: 1, verified: true }, agency: { raw: "หน่วยงานทดสอบ", value: "หน่วยงานทดสอบ", confidence: 1, verified: true }, budget: { raw: "100", value: 100, confidence: 1, verified: true }, deadline: { raw: overrides.deadline ?? future, value: overrides.deadline ?? future, confidence: 1, verified: true }, torStatus: { raw: overrides.status ?? "announced", value: overrides.status ?? "announced", confidence: 1, verified: true } }, announcedAt: now, sourceUrl: null, unverified: false, statusHistory: [], access: { restricted: overrides.restricted ?? false }, duplicateOf: null, createdAt: now, updatedAt: now })).insertedId.toString();
}

function service(enabled: boolean, extra: Partial<typeof base.notifications> = {}) { return new NotifyService(db, { ...base, notifications: { ...base.notifications, dispatchEnabled: enabled, ...extra } }, mailer, () => new Date("2026-10-07T06:00:00.000Z")); }

beforeAll(async () => { db = await connect(isolatedDbUrl(base.mongoUrl, "notify-service")); await ensureIndexes(db); });
beforeEach(async () => { deliveries = []; await Promise.all([accounts(db).deleteMany({}), bookmarks(db).deleteMany({}), vendorProfiles(db).deleteMany({}), tors(db).deleteMany({}), torClassifications(db).deleteMany({}), notifications(db).deleteMany({}), notificationLeases(db).deleteMany({})]); });
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
      const id = await vendor(); await tor(); await tor({ status: "awarded" });
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
});
