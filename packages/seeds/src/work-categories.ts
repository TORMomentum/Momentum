/**
 * The work a vendor can say they do, and the only vocabulary matching uses.
 *
 * Derived from Thailand's own classifications rather than invented:
 *
 *  - the five kinds of พัสดุ named by พ.ร.บ. การจัดซื้อจัดจ้างและการบริหารพัสดุ
 *    ภาครัฐ พ.ศ. 2560 — สินค้า, งานบริการ, งานก่อสร้าง, งานจ้างที่ปรึกษา, and
 *    งานจ้างออกแบบหรือควบคุมงานก่อสร้าง — give the top of the tree
 *  - the ครุภัณฑ์ types กรมบัญชีกลาง classifies by (สำนักงาน, คอมพิวเตอร์,
 *    โฆษณาและเผยแพร่, โทรคมนาคม, ไฟฟ้าและวิทยุ, ยานพาหนะและขนส่ง, วิทยาศาสตร์,
 *    การแพทย์, การศึกษา, การเกษตร, โรงงาน, งานบ้านงานครัว, กีฬา) give the goods
 *  - the Act's own list of consulting fields (วิศวกรรม, สถาปัตยกรรม, ผังเมือง,
 *    กฎหมาย, เศรษฐศาสตร์, การเงิน, การคลัง, สิ่งแวดล้อม) gives the advisory work
 *
 * Two levels, deliberately. A free-text category cannot be matched against —
 * the live corpus contains "ประกาศเชิญชวนอิเล็กทรอนิกส์" as a category, which is
 * a procurement method, not work — and a deeper tree cannot be filled in without
 * losing the vendor. A vendor picks a leaf or a whole group; a TOR classified to
 * a leaf still matches a vendor who chose its group, scoring lower than an exact
 * hit (profile and matching design §7.6).
 *
 * `unspsc` carries the Segment ("หมวดหลัก") of the United Nations Standard
 * Products and Services Code, which Thai e-GP classifies by. It is a crosswalk,
 * not the interface: records here come from published announcements rather than
 * e-GP's API, so a code is usually absent, and a group is never shown to a
 * vendor as a number.
 */

export interface WorkCategoryLeaf {
  /** Stable across renames: stored on profiles and matches, never the Thai label. */
  id: string;
  th: string;
  /** Words an announcement uses for this work, for the classifier's evidence. */
  synonyms: string[];
}

export interface WorkCategoryGroup {
  id: string;
  th: string;
  /** UNSPSC Segment this group crosswalks to, where one applies. */
  unspsc?: string;
  children: WorkCategoryLeaf[];
}

export const WORK_CATEGORIES: WorkCategoryGroup[] = [
  {
    id: "construction",
    th: "งานก่อสร้าง",
    unspsc: "72",
    children: [
      {
        id: "construction.road",
        th: "งานทาง สะพาน และท่อระบายน้ำ",
        synonyms: ["ก่อสร้างถนน", "ปรับปรุงถนน", "ผิวจราจร", "แอสฟัลต์", "คอนกรีตเสริมเหล็ก", "ท่อระบายน้ำ", "สะพาน", "ทางเท้า", "คันหิน", "รางระบายน้ำ"],
      },
      {
        id: "construction.building",
        th: "อาคารและสิ่งปลูกสร้าง",
        synonyms: ["ก่อสร้างอาคาร", "สิ่งปลูกสร้าง", "ศาลา", "โรงอาหาร", "รั้ว", "ป้อม", "หลังคาคลุม"],
      },
      {
        id: "construction.renovation",
        th: "ซ่อมแซม ต่อเติม ปรับปรุง และรื้อถอน",
        synonyms: ["ซ่อมแซม", "ต่อเติม", "ปรับปรุงอาคาร", "รื้อถอน", "ปรับปรุงซ่อมแซม"],
      },
      {
        id: "construction.mep",
        th: "ระบบไฟฟ้าและเครื่องกลในอาคาร",
        synonyms: ["ระบบไฟฟ้า", "ปรับอากาศ", "ลิฟต์", "ระบบดับเพลิง", "สุขาภิบาล", "เครื่องกล"],
      },
      {
        id: "construction.utilities",
        th: "ประปาและสาธารณูปโภค",
        synonyms: ["ระบบประปา", "วางท่อประปา", "หอถังสูง", "สาธารณูปโภค", "บ่อบาดาล"],
      },
      {
        id: "construction.irrigation",
        th: "เขื่อน คลอง และงานชลประทาน",
        synonyms: ["ชลประทาน", "ขุดลอก", "คลอง", "เขื่อน", "ฝาย", "ป้องกันตลิ่ง", "อ่างเก็บน้ำ"],
      },
      {
        id: "construction.streetlight",
        th: "ไฟฟ้าแสงสว่างสาธารณะ",
        synonyms: ["ไฟฟ้าแสงสว่าง", "โคมไฟถนน", "ไฟกิ่ง", "เสาไฟ", "ไฟสัญญาณจราจร"],
      },
      {
        id: "construction.landscape",
        th: "ภูมิทัศน์ สวนสาธารณะ และพื้นที่สีเขียว",
        synonyms: ["จัดสวน", "ภูมิทัศน์", "สวนสาธารณะ", "ปลูกต้นไม้", "สนามเด็กเล่น", "ลานกีฬา"],
      },
    ],
  },
  {
    id: "goods",
    th: "ครุภัณฑ์และวัสดุ",
    unspsc: "44",
    children: [
      { id: "goods.office", th: "ครุภัณฑ์สำนักงาน", synonyms: ["ครุภัณฑ์สำนักงาน", "โต๊ะ", "เก้าอี้", "ตู้เหล็ก", "เครื่องถ่ายเอกสาร"] },
      { id: "goods.computer", th: "ครุภัณฑ์คอมพิวเตอร์", synonyms: ["ครุภัณฑ์คอมพิวเตอร์", "คอมพิวเตอร์", "โน้ตบุ๊ก", "เครื่องพิมพ์", "เซิร์ฟเวอร์", "สแกนเนอร์"] },
      { id: "goods.broadcast", th: "ครุภัณฑ์โฆษณาและเผยแพร่", synonyms: ["โฆษณาและเผยแพร่", "โปรเจกเตอร์", "จอ LED", "กล้องถ่ายรูป", "กล้องวิดีโอ", "เครื่องเสียง"] },
      { id: "goods.telecom", th: "ครุภัณฑ์โทรคมนาคม", synonyms: ["โทรคมนาคม", "ตู้สาขาโทรศัพท์", "ประชุมทางไกล", "วิทยุสื่อสาร", "เสาสัญญาณ"] },
      { id: "goods.electrical", th: "ครุภัณฑ์ไฟฟ้าและวิทยุ", synonyms: ["ไฟฟ้าและวิทยุ", "เครื่องปรับอากาศ", "เครื่องกำเนิดไฟฟ้า", "UPS", "หม้อแปลง"] },
      { id: "goods.vehicle", th: "ยานพาหนะและขนส่ง", synonyms: ["ยานพาหนะ", "รถยนต์", "รถตู้", "รถบรรทุก", "จักรยานยนต์", "รถเก็บขยะ", "รถดับเพลิง"] },
      { id: "goods.science", th: "ครุภัณฑ์วิทยาศาสตร์", synonyms: ["ครุภัณฑ์วิทยาศาสตร์", "กล้องจุลทรรศน์", "เครื่องวัด", "ห้องปฏิบัติการ"] },
      { id: "goods.medical", th: "ครุภัณฑ์การแพทย์", synonyms: ["ครุภัณฑ์การแพทย์", "เตียงผู้ป่วย", "เครื่องเอกซเรย์", "เครื่องมือแพทย์", "เวชภัณฑ์"] },
      { id: "goods.education", th: "ครุภัณฑ์การศึกษา", synonyms: ["ครุภัณฑ์การศึกษา", "สื่อการเรียนการสอน", "ห้องเรียน", "อุปกรณ์ห้องปฏิบัติการ"] },
      { id: "goods.agriculture", th: "ครุภัณฑ์การเกษตร", synonyms: ["ครุภัณฑ์การเกษตร", "รถไถ", "เครื่องสูบน้ำ", "เครื่องพ่นยา"] },
      { id: "goods.industrial", th: "ครุภัณฑ์โรงงานและก่อสร้าง", synonyms: ["ครุภัณฑ์โรงงาน", "เครื่องกลึง", "เครื่องเชื่อม", "เครื่องจักรกล", "รถขุด"] },
      { id: "goods.household", th: "ครุภัณฑ์งานบ้านงานครัว", synonyms: ["งานบ้านงานครัว", "ตู้เย็น", "เตาอบ", "เครื่องซักผ้า", "เครื่องทำน้ำเย็น"] },
      { id: "goods.sport", th: "ครุภัณฑ์กีฬาและดนตรี", synonyms: ["ครุภัณฑ์กีฬา", "เครื่องออกกำลังกาย", "เครื่องดนตรี", "อุปกรณ์กีฬา"] },
      { id: "goods.survey", th: "ครุภัณฑ์สำรวจ", synonyms: ["ครุภัณฑ์สำรวจ", "กล้องวัดมุม", "กล้องระดับ", "เครื่องหาพิกัด"] },
      { id: "goods.supplies", th: "วัสดุสิ้นเปลืองและอุปกรณ์ทั่วไป", synonyms: ["วัสดุสำนักงาน", "วัสดุก่อสร้าง", "วัสดุไฟฟ้า", "วัสดุงานบ้าน", "หมึกพิมพ์"] },
    ],
  },
  {
    id: "it",
    th: "เทคโนโลยีสารสนเทศ",
    unspsc: "43",
    children: [
      { id: "it.software", th: "พัฒนาซอฟต์แวร์และเว็บแอปพลิเคชัน", synonyms: ["พัฒนาระบบ", "เว็บไซต์", "แอปพลิเคชัน", "ซอฟต์แวร์", "โมบายแอป", "API"] },
      { id: "it.data", th: "ระบบสารสนเทศและฐานข้อมูล", synonyms: ["ฐานข้อมูล", "ระบบสารสนเทศ", "คลังข้อมูล", "วิเคราะห์ข้อมูล", "แดชบอร์ด", "บิ๊กดาต้า"] },
      { id: "it.network", th: "เครือข่ายและโครงสร้างพื้นฐานไอที", synonyms: ["ระบบเครือข่าย", "เซิร์ฟเวอร์", "คลาวด์", "อินเทอร์เน็ต", "ศูนย์ข้อมูล", "ระบบสำรองข้อมูล"] },
      { id: "it.security", th: "ความปลอดภัยไซเบอร์", synonyms: ["ความมั่นคงปลอดภัยไซเบอร์", "ความปลอดภัยสารสนเทศ", "firewall", "ตรวจสอบช่องโหว่", "PDPA"] },
      { id: "it.gis", th: "ภูมิสารสนเทศและแผนที่ดิจิทัล", synonyms: ["ภูมิสารสนเทศ", "แผนที่", "GIS", "ภาพถ่ายทางอากาศ", "โดรนสำรวจ"] },
      { id: "it.maintenance", th: "ดูแลระบบและบำรุงรักษาไอที", synonyms: ["บำรุงรักษาระบบ", "ดูแลระบบคอมพิวเตอร์", "MA", "ซ่อมบำรุงคอมพิวเตอร์"] },
      { id: "it.digitisation", th: "จัดทำและแปลงข้อมูลดิจิทัล", synonyms: ["สแกนเอกสาร", "จัดเก็บเอกสารอิเล็กทรอนิกส์", "แปลงข้อมูล", "บันทึกข้อมูล"] },
      { id: "it.ai", th: "ปัญญาประดิษฐ์และระบบอัตโนมัติ", synonyms: ["ปัญญาประดิษฐ์", "AI", "แมชชีนเลิร์นนิง", "ระบบอัตโนมัติ", "ชาตบอต"] },
    ],
  },
  {
    id: "services",
    th: "งานบริการและจ้างเหมา",
    unspsc: "80",
    children: [
      { id: "services.security", th: "รักษาความปลอดภัย", synonyms: ["รักษาความปลอดภัย", "ยามรักษาการณ์", "รปภ.", "กล้องวงจรปิด"] },
      { id: "services.cleaning", th: "ทำความสะอาดและดูแลสถานที่", synonyms: ["ทำความสะอาด", "แม่บ้าน", "ดูแลสถานที่", "ทำความสะอาดอาคาร"] },
      { id: "services.grounds", th: "ดูแลสวน ตัดหญ้า และต้นไม้", synonyms: ["ตัดหญ้า", "ดูแลสวน", "ตัดแต่งต้นไม้", "ดูแลต้นไม้"] },
      { id: "services.waste", th: "เก็บขนและกำจัดขยะ", synonyms: ["เก็บขนขยะ", "กำจัดขยะ", "ขยะมูลฝอย", "ดูดสิ่งปฏิกูล"] },
      { id: "services.logistics", th: "ขนส่งและเช่ายานพาหนะ", synonyms: ["ขนส่ง", "ขนย้าย", "เช่ารถ", "เช่ารถยนต์", "โลจิสติกส์"] },
      { id: "services.catering", th: "อาหารและโภชนาการ", synonyms: ["อาหาร", "อาหารกลางวัน", "จัดเลี้ยง", "โภชนาการ", "อาหารเสริมนม"] },
      { id: "services.maintenance", th: "บำรุงรักษาเครื่องจักรและระบบ", synonyms: ["บำรุงรักษา", "ซ่อมบำรุง", "ดูแลลิฟต์", "ล้างเครื่องปรับอากาศ"] },
      { id: "services.pest", th: "กำจัดแมลงและสัตว์พาหะ", synonyms: ["กำจัดปลวก", "กำจัดยุง", "พ่นหมอกควัน", "กำจัดสัตว์พาหะ"] },
      { id: "services.staffing", th: "จ้างเหมาบุคลากร", synonyms: ["จ้างเหมาบริการบุคคล", "จ้างเหมาแรงงาน", "ผู้ช่วยปฏิบัติงาน"] },
      { id: "services.insurance", th: "ประกันภัยและบริการทางการเงิน", synonyms: ["ประกันภัย", "ประกันภัยรถยนต์", "ประกันอัคคีภัย"] },
    ],
  },
  {
    id: "consulting",
    th: "งานจ้างที่ปรึกษา",
    unspsc: "80",
    children: [
      { id: "consulting.engineering", th: "ที่ปรึกษาด้านวิศวกรรม", synonyms: ["ที่ปรึกษาวิศวกรรม", "วิศวกรที่ปรึกษา", "ศึกษาความเหมาะสม", "ออกแบบเบื้องต้น"] },
      { id: "consulting.urban", th: "ที่ปรึกษาด้านสถาปัตยกรรมและผังเมือง", synonyms: ["ผังเมือง", "ที่ปรึกษาสถาปัตยกรรม", "วางผัง", "ผังแม่บท"] },
      { id: "consulting.legal", th: "ที่ปรึกษาด้านกฎหมาย", synonyms: ["ที่ปรึกษากฎหมาย", "ยกร่างกฎหมาย", "นิติกรรมสัญญา"] },
      { id: "consulting.economics", th: "ที่ปรึกษาด้านเศรษฐศาสตร์ การเงินและการคลัง", synonyms: ["เศรษฐศาสตร์", "การเงิน", "การคลัง", "วิเคราะห์การลงทุน", "ศึกษาความคุ้มค่า"] },
      { id: "consulting.environment", th: "ที่ปรึกษาด้านสิ่งแวดล้อม", synonyms: ["สิ่งแวดล้อม", "EIA", "ผลกระทบสิ่งแวดล้อม", "ประเมินผลกระทบ"] },
      { id: "consulting.research", th: "ศึกษา วิจัยและประเมินผล", synonyms: ["ศึกษาวิจัย", "วิจัย", "ประเมินผล", "สำรวจความคิดเห็น", "จัดทำแผน"] },
      { id: "consulting.management", th: "ที่ปรึกษาด้านบริหารจัดการ", synonyms: ["ที่ปรึกษาบริหาร", "พัฒนาองค์กร", "ระบบคุณภาพ", "ISO"] },
    ],
  },
  {
    id: "design",
    th: "งานออกแบบและควบคุมงานก่อสร้าง",
    unspsc: "81",
    children: [
      { id: "design.architecture", th: "ออกแบบงานสถาปัตยกรรม", synonyms: ["ออกแบบอาคาร", "สถาปนิก", "เขียนแบบ", "ออกแบบตกแต่งภายใน"] },
      { id: "design.engineering", th: "ออกแบบงานวิศวกรรม", synonyms: ["ออกแบบงานโยธา", "ออกแบบระบบ", "คำนวณโครงสร้าง"] },
      { id: "design.supervision", th: "ควบคุมงานก่อสร้าง", synonyms: ["ควบคุมงาน", "ผู้ควบคุมงาน", "บริหารโครงการก่อสร้าง"] },
      { id: "design.survey", th: "สำรวจและรังวัด", synonyms: ["สำรวจ", "รังวัด", "สำรวจออกแบบ", "จัดทำแผนที่"] },
    ],
  },
  {
    id: "communications",
    th: "สื่อสาร ประชาสัมพันธ์และกิจกรรม",
    unspsc: "82",
    children: [
      { id: "communications.print", th: "ผลิตสื่อและสิ่งพิมพ์", synonyms: ["สิ่งพิมพ์", "จัดพิมพ์", "ผลิตเอกสาร", "ป้ายไวนิล", "โบรชัวร์"] },
      { id: "communications.video", th: "ผลิตวีดิทัศน์และภาพถ่าย", synonyms: ["วีดิทัศน์", "ผลิตวิดีโอ", "ถ่ายภาพ", "สารคดี", "สปอตโฆษณา"] },
      { id: "communications.events", th: "จัดงานและนิทรรศการ", synonyms: ["จัดงาน", "นิทรรศการ", "กิจกรรม", "เวที", "บูธ", "งานประเพณี"] },
      { id: "communications.pr", th: "ประชาสัมพันธ์และสื่อออนไลน์", synonyms: ["ประชาสัมพันธ์", "โฆษณา", "สื่อออนไลน์", "แคมเปญ", "โซเชียลมีเดีย"] },
      { id: "communications.design", th: "ออกแบบกราฟิกและอัตลักษณ์", synonyms: ["ออกแบบกราฟิก", "อัตลักษณ์องค์กร", "โลโก้", "อาร์ตเวิร์ก"] },
    ],
  },
  {
    id: "training",
    th: "ฝึกอบรมและพัฒนาบุคลากร",
    unspsc: "86",
    children: [
      { id: "training.courses", th: "จัดฝึกอบรมและสัมมนา", synonyms: ["ฝึกอบรม", "สัมมนา", "อบรมเชิงปฏิบัติการ", "ประชุมเชิงปฏิบัติการ"] },
      { id: "training.curriculum", th: "พัฒนาหลักสูตรและสื่อการเรียน", synonyms: ["พัฒนาหลักสูตร", "สื่อการเรียนรู้", "e-learning", "บทเรียนออนไลน์"] },
      { id: "training.studyvisit", th: "ศึกษาดูงานและแลกเปลี่ยนเรียนรู้", synonyms: ["ศึกษาดูงาน", "ทัศนศึกษา", "แลกเปลี่ยนเรียนรู้"] },
    ],
  },
  {
    id: "environment",
    th: "สิ่งแวดล้อมและสาธารณสุข",
    unspsc: "77",
    children: [
      { id: "environment.water", th: "บำบัดน้ำเสียและคุณภาพน้ำ", synonyms: ["บำบัดน้ำเสีย", "ระบบบำบัด", "คุณภาพน้ำ", "ตรวจวัดน้ำ"] },
      { id: "environment.waste", th: "จัดการของเสียและของเสียอันตราย", synonyms: ["ของเสียอันตราย", "ขยะติดเชื้อ", "กำจัดของเสีย", "รีไซเคิล"] },
      { id: "environment.monitoring", th: "ตรวจวัดและเฝ้าระวังคุณภาพสิ่งแวดล้อม", synonyms: ["ตรวจวัดคุณภาพอากาศ", "เฝ้าระวัง", "PM2.5", "ตรวจวัดเสียง"] },
      { id: "environment.health", th: "บริการทางการแพทย์และสาธารณสุข", synonyms: ["บริการทางการแพทย์", "ตรวจสุขภาพ", "สาธารณสุข", "ควบคุมโรค"] },
      { id: "environment.energy", th: "พลังงานและการอนุรักษ์พลังงาน", synonyms: ["พลังงานทดแทน", "โซลาร์เซลล์", "อนุรักษ์พลังงาน", "ประหยัดพลังงาน"] },
    ],
  },
];

/**
 * Words that appear in a category field but describe HOW something is bought,
 * not WHAT is being bought. The live corpus holds "ประกวดราคาอิเล็กทรอนิกส์"
 * as a category; classifying it as work would be wrong in a way no score can
 * recover from, so it is rejected outright as a field-type error.
 */
export const NOT_A_CATEGORY: string[] = [
  "ประกวดราคาอิเล็กทรอนิกส์",
  "ประกวดราคา",
  "ประกาศเชิญชวน",
  "e-bidding",
  "สอบราคา",
  "วิธีเฉพาะเจาะจง",
  "วิธีคัดเลือก",
  "ตลาดอิเล็กทรอนิกส์",
  "e-market",
  "จัดซื้อจัดจ้าง",
  "ร่างขอบเขตของงาน",
  "TOR",
];

/** Every leaf, flattened — what a lookup by id reads. */
export const WORK_CATEGORY_LEAVES: ReadonlyArray<WorkCategoryLeaf & { groupId: string }> =
  WORK_CATEGORIES.flatMap((group) => group.children.map((leaf) => ({ ...leaf, groupId: group.id })));

/**
 * Bumped whenever a label, synonym or id changes. Stored beside every
 * classification so a match made under an older vocabulary can still be
 * explained, and so a reclassification is reproducible (design §7.5).
 */
export const TAXONOMY_VERSION = "2026-10-07b";
