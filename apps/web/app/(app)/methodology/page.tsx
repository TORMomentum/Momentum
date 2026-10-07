import { fetchDashboard, StatsApiUnavailable } from "../../../src/shared/api/stats.api";
import styles from "./methodology.module.css";

// The active rule's numbers come from a live API call, so this page cannot be
// prerendered once at build time — see the homepage for why (TOR-140).
export const dynamic = "force-dynamic";

export default async function MethodologyPage() {
  try {
    const { rule } = await fetchDashboard();
    const limit = rule.method === "IQR" ? `${rule.iqrMultiplier} × IQR` : `z-score ${rule.zScoreLimit}`;
    return (
      <main className={styles.page}>
        <h1>ระเบียบวิธีข้อมูลสถิติ</h1>
        <p>ระบบแสดงความผิดปกติทางสถิติจากงบประมาณของ TOR ที่อยู่ในกลุ่มเปรียบเทียบเดียวกัน ไม่ใช่ข้อกล่าวหาเกี่ยวกับ TOR งบประมาณ หรือหน่วยงาน</p>
        <dl className={styles.rule}>
          <dt>วิธีที่ใช้งาน</dt><dd>{rule.method}</dd>
          <dt>เกณฑ์</dt><dd>{limit}</dd>
          <dt>จำนวน TOR ขั้นต่ำในกลุ่มเปรียบเทียบ</dt><dd>{rule.peerMinN.toLocaleString("th-TH")} รายการ</dd>
          <dt>ช่วงเวลากลุ่มเปรียบเทียบ</dt><dd>{rule.windowMonths.toLocaleString("th-TH")} เดือน</dd>
          <dt>เขตเวลาของกลุ่มเปรียบเทียบ</dt><dd>{rule.cohortTimezone}</dd>
        </dl>
        <p>กลุ่มเปรียบเทียบใช้หมวดหมู่และเดือนของวันที่ประกาศ TOR ในเขตเวลา {rule.cohortTimezone}; หากไม่มีวันที่ประกาศ ระบบใช้วันที่รับเอกสารแทน</p>
        <p>การตรวจสอบคุณภาพข้อกำหนดจะแสดงใน Sprint 4</p>
      </main>
    );
  } catch (error) {
    console.error("[methodology] load failed", error);
    return <main className={styles.page}><h1>ระเบียบวิธีข้อมูลสถิติ</h1><p>{error instanceof StatsApiUnavailable ? "ยังเปิดระเบียบวิธีไม่ได้ โปรดลองใหม่อีกครั้ง" : "ยังเปิดระเบียบวิธีไม่ได้"}</p></main>;
  }
}
