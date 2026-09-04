import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../app";

/** Stub the upstream so tests never touch the live government API. */
type FetchStub = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function mockUpstream(payload: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn<FetchStub>(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /sources/bma-egp/tors", () => {
  it("normalizes projects and resolves the BMA agency", async () => {
    mockUpstream({
      totalCount: 4873,
      pageCount: 244,
      currentPage: 1,
      data: [
        {
          projectId: "p-1",
          projectNumber: "69089511467",
          projectName: "จ้างพัฒนาระบบสารสนเทศ",
          masterOrgGroupName: "สำนักการระบายน้ำ",
          masterOrgDepartmentName: "กองระบบท่อระบายน้ำ",
          projectBudget: 1000,
        },
      ],
    });

    const res = await request(app).get("/sources/bma-egp/tors");

    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(4873);
    expect(res.body.data[0]).toMatchObject({
      projectId: "p-1",
      title: "จ้างพัฒนาระบบสารสนเทศ",
      agencyName: "สำนักการระบายน้ำ",
      isBmaAgency: true,
      projectUrl: "https://egp2.bangkok.go.th/project-detail/p-1",
    });
    expect(res.body.data[0].agencyId).toEqual(expect.any(String));
  });

  it("tags a project whose agency is not on the canonical BMA list (FR-A4)", async () => {
    mockUpstream({
      totalCount: 1,
      pageCount: 1,
      currentPage: 1,
      data: [
        {
          projectId: "p-2",
          projectNumber: "1",
          projectName: "โครงการนอกพื้นที่",
          masterOrgGroupName: "เทศบาลนครเชียงใหม่",
        },
      ],
    });

    const res = await request(app).get("/sources/bma-egp/tors");

    expect(res.body.data[0].isBmaAgency).toBe(false);
    expect(res.body.data[0].agencyId).toBeNull();
  });

  it("always requests the TOR announcement type and clamps the page size", async () => {
    const fetchMock = mockUpstream({ totalCount: 0, pageCount: 0, currentPage: 1, data: [] });

    await request(app).get("/sources/bma-egp/tors?pageSize=9999&page=3&q=ระบบ");

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("masterAnnounceTypeId=24995aa2-d875-4d3d-9dec-d5e22d222aa4");
    expect(url).toContain("pageSize=100");
    expect(url).toContain("pageNo=3");
    expect(url).toContain(`projectSearchText=${encodeURIComponent("ระบบ")}`);
  });

  it("retries a transient upstream failure before giving up", async () => {
    const page = { totalCount: 1, pageCount: 1, currentPage: 1, data: [] };
    let calls = 0;
    const fetchMock = vi.fn<FetchStub>(async () => {
      calls += 1;
      return calls === 1
        ? { ok: false, status: 503, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => page };
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).get("/sources/bma-egp/tors");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(200);
  });

  it("does not retry a client error from the source", async () => {
    const fetchMock = mockUpstream({}, { ok: false, status: 400 });

    await request(app).get("/sources/bma-egp/tors");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an upstream failure as a bad gateway, not a server error", async () => {
    mockUpstream({}, { ok: false, status: 503 });

    const res = await request(app).get("/sources/bma-egp/tors");

    expect(res.status).toBe(502);
    expect(res.body.error).toBe("source_unavailable");
  });
});

describe("GET /sources/bma-egp/tors/:projectId/documents", () => {
  it("returns only TOR documents, with their permanent source URLs", async () => {
    mockUpstream({
      data: [
        {
          id: "fe412327-7c3b-457b-b4f7-6eb4637f286d",
          masterAnnounceTypeName: "ร่างขอบเขตของงาน (TOR)",
          projectAnnouncementPath: "TOR_ผ้า_ปี_70.pdf",
          projectAnnouncementPublishDate: "2026-08-01T00:00:00",
        },
        {
          id: "other",
          masterAnnounceTypeName: "ประกาศราคากลาง",
          projectAnnouncementPath: "price.pdf",
        },
      ],
    });

    const res = await request(app).get("/sources/bma-egp/tors/p-1/documents");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].sourceUrl).toBe(
      `https://egp2.bangkok.go.th/api/file/fe412327-7c3b-457b-b4f7-6eb4637f286d/${encodeURIComponent("TOR_ผ้า_ปี_70.pdf")}`,
    );
  });
});
