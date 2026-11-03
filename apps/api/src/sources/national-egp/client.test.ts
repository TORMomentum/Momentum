import { describe, expect, it } from "vitest";
import { announcementListUrl, buildProjectSearchUrl, decodeFeed, fileIdFromLink, packageUrl, parseFeed, parseFeedDate } from "./client.js";

// The item as e-GP published it for project 69099218130 on 2026-09-08.
const feed = `<?xml version="1.0" encoding="Windows-874" ?>
<rss version="2.0"><channel>
  <title>ประกาศจัดซื้อจัดจ้างภาครัฐ</title>
  <item>
    <title>ประกวดราคาซื้อหินใหญ่คละ ขนาด 15-30 ซม. &amp; อื่นๆ</title>
    <link>https://process5.gprocurement.go.th/egp-upload-service/v1/downloadFileTest?fileId=b4d4dcd9ac3b4b0da09dcc381180ac36</link>
    <description>69099218130, ประกวดราคาอิเล็กทรอนิกส์ (e-bidding), ร่างเอกสารประกวดราคา (e-Bidding)</description>
    <pubDate>2026-09-08</pubDate>
  </item>
  <item>
    <title>รายการที่ไม่มีเลขโครงการ</title>
    <description>ไม่ระบุ</description>
  </item>
</channel></rss>`;

describe("parseFeed", () => {
  it("reads each item's project number, title, method, link and date", () => {
    const [item, ...rest] = parseFeed(feed, "B0");

    expect(rest).toEqual([]);
    expect(item).toEqual({
      projectId: "69099218130",
      title: "ประกวดราคาซื้อหินใหญ่คละ ขนาด 15-30 ซม. & อื่นๆ",
      announceType: "B0",
      link: "https://process5.gprocurement.go.th/egp-upload-service/v1/downloadFileTest?fileId=b4d4dcd9ac3b4b0da09dcc381180ac36",
      pubDate: "2026-09-08",
      procurementMethod: "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
    });
  });

  it("drops an item that names no project, because there is no package to fetch", () => {
    expect(parseFeed(feed, "B0").map((i) => i.title)).not.toContain("รายการที่ไม่มีเลขโครงการ");
  });

  it("reads CDATA sections", () => {
    const xml = "<item><title><![CDATA[จ้าง <ระบบ>]]></title><description>69010012345</description></item>";

    expect(parseFeed(xml, "D0")[0]).toMatchObject({ title: "จ้าง <ระบบ>", projectId: "69010012345" });
  });

  it("returns nothing for the weekend feed, which has no items", () => {
    expect(parseFeed("<rss><channel><countbyday>0</countbyday></channel></rss>", "D0")).toEqual([]);
  });
});

describe("decodeFeed", () => {
  it("decodes a feed declared Windows-874", () => {
    // "ประกาศ" in TIS-620 / Windows-874.
    const thai = Buffer.from([0xbb, 0xc3, 0xd0, 0xa1, 0xd2, 0xc8]);
    const bytes = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="Windows-874" ?><t>'), thai]);

    expect(decodeFeed(bytes)).toContain("ประกาศ");
  });

  it("reads a feed with no declaration as UTF-8", () => {
    expect(decodeFeed(Buffer.from("<t>ประกาศ</t>", "utf8"))).toBe("<t>ประกาศ</t>");
  });
});

describe("parseFeedDate", () => {
  it("parses a plain date, an RFC 822 date, and the feed's ICT zone", () => {
    expect(parseFeedDate("2026-09-08")?.toISOString()).toBe("2026-09-08T00:00:00.000Z");
    expect(parseFeedDate("Fri, 04 Sep 2026 09:30:00 +0700")?.toISOString()).toBe("2026-09-04T02:30:00.000Z");
    expect(parseFeedDate("Sun, 04 Oct 2026 05:08:27 ICT")?.toISOString()).toBe("2026-10-03T22:08:27.000Z");
  });

  it("returns undefined for a missing or unreadable date", () => {
    expect(parseFeedDate(undefined)).toBeUndefined();
    expect(parseFeedDate("เมื่อวาน")).toBeUndefined();
  });
});

describe("fileIdFromLink", () => {
  it("reads the package id from a download link, and nothing from other links", () => {
    expect(fileIdFromLink(packageUrl("b4d4dcd9ac3b4b0da09dcc381180ac36"))).toBe("b4d4dcd9ac3b4b0da09dcc381180ac36");
    expect(fileIdFromLink("http://process.gprocurement.go.th/egp2procmainWeb/procsearch.sch")).toBeUndefined();
    expect(fileIdFromLink(undefined)).toBeUndefined();
  });
});

describe("announcementListUrl", () => {
  it("asks for the first page plainly and a later page by its row range, as the list's own ถัดไป does", () => {
    const first = new URL(announcementListUrl("tor"));
    const third = new URL(announcementListUrl("invitation", 3));

    expect(first.searchParams.get("announceType")).toBe("1");
    expect(first.searchParams.has("beginrec")).toBe(false);
    expect(third.searchParams.get("announceType")).toBe("2");
    expect([third.searchParams.get("beginrec"), third.searchParams.get("endrec"), third.searchParams.get("grouppage")]).toEqual(["101", "151", "3"]);
  });
});

describe("buildProjectSearchUrl", () => {
  it("opens e-GP's public search on the project number", () => {
    expect(buildProjectSearchUrl("68039469567")).toBe(
      "https://process5.gprocurement.go.th/egp-agpc01-web/announcement?keywordSearch=68039469567",
    );
  });
});
