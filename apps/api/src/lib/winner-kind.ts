/**
 * Whether a winning bidder's name is a juristic person's (TOR-221, FR-B-5). A company, partnership, cooperative,
 * joint venture, shop or association, and a public body or school, is shown by name; anything else — a person's name, or a name the rule does
 * not recognise — is treated as an individual's and is not shown. When in doubt, the name stays out.
 */
const JURISTIC =
  /(บริษัท|บจก\.?|ห้างหุ้นส่วน|หจก\.?|หสน\.?|จำกัด|มหาชน|สหกรณ์|กิจการร่วมค้า|กิจการค้าร่วม|มูลนิธิ|สมาคม|^ร้าน|^ห้าง|\bco\.?,?\s*ltd\b|\blimited\b|\bcompany\b|\bcorporation\b|\binc\.?\b|\bpartnership\b)/iu;

/**
 * A public body or an educational institution, named by how its name begins: a university, school, college,
 * institute, ministry, office, municipality, public organisation or hospital. Only at the start, so a surname
 * cannot match. "ศูนย์…" is left out: a "ศูนย์ถ่ายเอกสาร" can be one person's business.
 */
const PUBLIC_BODY =
  /^(มหาวิทยาลัย|โรงเรียน|วิทยาลัย|สถาบัน|กระทรวง|สำนักงาน|เทศบาล|องค์การ|องค์กร|โรงพยาบาล|การไฟฟ้า|การประปา|university|college|school|institute)/iu;

/** Titles that open a person's name. Checked first: "นายสมชาย จำกัดพันธ์" is a person, not a company. */
const PERSON = /^(นาย|นางสาว|นาง|น\.ส\.|ด\.ช\.|ด\.ญ\.|mr\.?|mrs\.?|ms\.?|miss)\s*/iu;

export function winnerKindOf(name: string | null): "juristic" | "individual" {
  if (!name) return "individual";
  const trimmed = name.trim();
  if (PERSON.test(trimmed)) return "individual";
  return JURISTIC.test(trimmed) || PUBLIC_BODY.test(trimmed) ? "juristic" : "individual";
}
