import { fetchDashboard, StatsApiUnavailable } from "../../../src/shared/api/stats.api";
import styles from "./methodology.module.css";

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
        <h2>การตรวจคุณภาพข้อกำหนด</h2>
        <p>ระบบตรวจข้อกำหนดของ TOR ห้าข้อ เป็นการประเมินโดยระบบอัตโนมัติ (AI-generated specification-quality check) ไม่ใช่การตัดสินทางกฎหมายหรือการทุจริต</p>
        <ol>
          <li><strong>งบประมาณระบุไว้</strong> ผ่านเมื่อพบงบประมาณในเอกสาร อยู่ในช่วงที่ระบบรับเปรียบเทียบได้ และได้รับการยืนยันแล้ว</li>
          <li><strong>ระยะเวลายื่นข้อเสนอเพียงพอ</strong> ยังไม่ประเมิน เพราะเกณฑ์ระยะเวลาขั้นต่ำยังไม่ได้ปรับเทียบจากข้อมูลจริง</li>
          <li><strong>ขอบเขตงานเจาะจง</strong> ยังไม่ประเมิน เพราะเกณฑ์ความยาวและจำนวนหัวข้อของขอบเขตงานยังไม่ได้ปรับเทียบจากข้อมูลจริง</li>
          <li><strong>ระบุคุณสมบัติผู้รับจ้าง</strong> ผ่านเมื่อพบคุณสมบัติที่จับคู่กับอนุกรมวิธานได้ และคุณสมบัตินั้นได้รับการยืนยันแล้ว</li>
          <li><strong>งบประมาณอยู่ในช่วงปกติของกลุ่มเปรียบเทียบ</strong> ผ่านเมื่อไม่เป็น statistical anomaly ตามกฎข้างต้น หรือเมื่อกลุ่มเปรียบเทียบมีจำนวนไม่พอ ไม่ผ่านเมื่อเป็น statistical anomaly และยังไม่ประเมินเมื่อข้อมูลที่ใช้เปรียบเทียบยังไม่ได้รับการยืนยัน</li>
        </ol>
        <p>คะแนนนับเฉพาะข้อที่ประเมินได้ ข้อที่ยังไม่ประเมินไม่นับทั้งผ่านและไม่ผ่าน</p>
      </main>
    );
  } catch (error) {
    console.error("[methodology] load failed", error);
    return <main className={styles.page}><h1>ระเบียบวิธีข้อมูลสถิติ</h1><p>{error instanceof StatsApiUnavailable ? "ยังเปิดระเบียบวิธีไม่ได้ โปรดลองใหม่อีกครั้ง" : "ยังเปิดระเบียบวิธีไม่ได้"}</p></main>;
  }
}
