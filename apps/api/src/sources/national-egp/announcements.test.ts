import { describe, expect, it } from "vitest";
import { parseAnnouncementList } from "./announcements.js";

// Two rows as e-GP's list served them on 06/10/2569: a draft TOR (with its comment period) and an
// invitation, plus the second, hidden copy of the project number the page's link script carries.
const page = `
<table>
<tr><td>ลำดับ</td><td>หน่วยงาน</td></tr>
<tr id="trDetail1" class="tr0" style="display: none;">
  <td align="center">1</td>
  <td align="left">สถาบันโรคทรวงอก&nbsp;</td>
  <td align="left"><span onclick="showPopupFileNew('69109068322')">ประกวดราคาซื้อเวชภัณฑ์ยา Ketoanalogues 600 mg Tablet ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)&nbsp;(เลขที่โครงการ&nbsp;:&nbsp;69109068322)</span></td>
  <td align="center">06/10/2569<br>&nbsp;-&nbsp;14/10/2569&nbsp;</td>
  <td align="right">2,311,200.00&nbsp;</td>
  <td align="center">ระหว่างดำเนินการ</td>
  <td align="center"><a href="#" onclick="chklink('69109068322','สถาบันโรคทรวงอก')"><img src="doc02.gif"></a></td>
</tr>
<tr id="trDetail2" class="tr1" style="display: none;">
  <td align="center">2</td>
  <td align="left">โรงเรียนเทพศิรินทร์&nbsp;</td>
  <td align="left"><span>ประกวดราคาจ้างก่อสร้างปรับปรุงห้องสมุด &amp; อาคาร&nbsp;(เลขที่โครงการ&nbsp;:&nbsp;69099711664)</span></td>
  <td align="center">06/10/2569&nbsp;</td>
  <td align="right">6,783,783.19&nbsp;</td>
  <td align="center">ระหว่างดำเนินการ</td>
  <td align="center"></td>
</tr>
<tr id="trDetail3"><td>3</td><td>หน่วยงาน</td><td>ไม่มีเลขโครงการ</td><td>06/10/2569</td><td>-</td><td>-</td><td></td></tr>
</table>`;

describe("parseAnnouncementList", () => {
  it("reads each row's project number, title, agency, date and budget", () => {
    const [draft, invitation, ...rest] = parseAnnouncementList(page);

    expect(rest).toEqual([]);
    expect(draft).toEqual({
      projectId: "69109068322",
      title: "ประกวดราคาซื้อเวชภัณฑ์ยา Ketoanalogues 600 mg Tablet ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
      agency: "สถาบันโรคทรวงอก",
      announcedOn: "2026-10-06",
      commentEndsOn: "2026-10-14",
      budget: { raw: "2,311,200.00", value: 2_311_200 },
      status: "ระหว่างดำเนินการ",
    });
    expect(invitation).toMatchObject({
      projectId: "69099711664",
      title: "ประกวดราคาจ้างก่อสร้างปรับปรุงห้องสมุด & อาคาร",
      announcedOn: "2026-10-06",
      budget: { value: 6_783_783.19 },
    });
    expect(invitation.commentEndsOn).toBeUndefined();
  });

  it("drops a row without a project number, and lists each project once", () => {
    const doubled = page.replace("</table>", page.match(/<tr id="trDetail1"[\s\S]*?<\/tr>/)![0] + "</table>");

    expect(parseAnnouncementList(doubled).map((item) => item.projectId)).toEqual(["69109068322", "69099711664"]);
  });

  it("returns nothing for a page with no results", () => {
    expect(parseAnnouncementList("<html><body>ไม่พบข้อมูล</body></html>")).toEqual([]);
  });
});
