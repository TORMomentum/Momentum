export const REGIONS = [
  { id: "north", th: "ภาคเหนือ" },
  { id: "northeast", th: "ภาคตะวันออกเฉียงเหนือ" },
  { id: "central", th: "ภาคกลาง" },
  { id: "east", th: "ภาคตะวันออก" },
  { id: "west", th: "ภาคตะวันตก" },
  { id: "south", th: "ภาคใต้" },
] as const;

export type RegionId = (typeof REGIONS)[number]["id"];
export interface Province { id: string; th: string; region: RegionId }

// Stable ids let profiles survive presentation-label changes.
export const PROVINCES: readonly Province[] = [
  ["chiang-mai","เชียงใหม่","north"],["chiang-rai","เชียงราย","north"],["lamphun","ลำพูน","north"],["lampang","ลำปาง","north"],["mae-hong-son","แม่ฮ่องสอน","north"],["nan","น่าน","north"],["phayao","พะเยา","north"],["phrae","แพร่","north"],["uttaradit","อุตรดิตถ์","north"],["tak","ตาก","north"],["sukhothai","สุโขทัย","north"],["phitsanulok","พิษณุโลก","north"],["phichit","พิจิตร","north"],["phetchabun","เพชรบูรณ์","north"],["nakhon-sawan","นครสวรรค์","north"],["uthai-thani","อุทัยธานี","north"],["kamphaeng-phet","กำแพงเพชร","north"],
  ["nakhon-ratchasima","นครราชสีมา","northeast"],["buri-ram","บุรีรัมย์","northeast"],["surin","สุรินทร์","northeast"],["si-sa-ket","ศรีสะเกษ","northeast"],["ubon-ratchathani","อุบลราชธานี","northeast"],["yasothon","ยโสธร","northeast"],["chaiyaphum","ชัยภูมิ","northeast"],["amnat-charoen","อำนาจเจริญ","northeast"],["bueng-kan","บึงกาฬ","northeast"],["nong-bua-lamphu","หนองบัวลำภู","northeast"],["khon-kaen","ขอนแก่น","northeast"],["udon-thani","อุดรธานี","northeast"],["loei","เลย","northeast"],["nong-khai","หนองคาย","northeast"],["maha-sarakham","มหาสารคาม","northeast"],["roi-et","ร้อยเอ็ด","northeast"],["kalasin","กาฬสินธุ์","northeast"],["sakonnakhon","สกลนคร","northeast"],["nakhon-phanom","นครพนม","northeast"],["mukdahan","มุกดาหาร","northeast"],
  ["bangkok","กรุงเทพมหานคร","central"],["nonthaburi","นนทบุรี","central"],["pathum-thani","ปทุมธานี","central"],["phra-nakhon-si-ayutthaya","พระนครศรีอยุธยา","central"],["ang-thong","อ่างทอง","central"],["lop-buri","ลพบุรี","central"],["sing-buri","สิงห์บุรี","central"],["chai-nat","ชัยนาท","central"],["sara-buri","สระบุรี","central"],["nakhon-pathom","นครปฐม","central"],["samut-sakhon","สมุทรสาคร","central"],["samut-songkhram","สมุทรสงคราม","central"],["samut-prakan","สมุทรปราการ","central"],["nakhon-nayok","นครนายก","central"],["prachin-buri","ปราจีนบุรี","central"],["sa-kaeo","สระแก้ว","central"],
  ["chon-buri","ชลบุรี","east"],["rayong","ระยอง","east"],["chanthaburi","จันทบุรี","east"],["trat","ตราด","east"],["chachoengsao","ฉะเชิงเทรา","east"],
  ["ratchaburi","ราชบุรี","west"],["kanchanaburi","กาญจนบุรี","west"],["suphan-buri","สุพรรณบุรี","west"],["phetchaburi","เพชรบุรี","west"],["prachuap-khiri-khan","ประจวบคีรีขันธ์","west"],
  ["chumphon","ชุมพร","south"],["ranong","ระนอง","south"],["surat-thani","สุราษฎร์ธานี","south"],["phang-nga","พังงา","south"],["phuket","ภูเก็ต","south"],["krabi","กระบี่","south"],["nakhon-si-thammarat","นครศรีธรรมราช","south"],["trang","ตรัง","south"],["phatthalung","พัทลุง","south"],["satun","สตูล","south"],["songkhla","สงขลา","south"],["pattani","ปัตตานี","south"],["yala","ยะลา","south"],["narathiwat","นราธิวาส","south"],
].map(([id, th, region]) => ({ id, th, region: region as RegionId }));

export const WHOLE_COUNTRY_AREA = "thailand";
