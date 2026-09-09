import { VendorOnly } from "../../../src/features/app-shell/VendorOnly";
import { VendorProfileView } from "../../../src/views/VendorProfileView";

export default function ProfilePage() {
  return (
    <VendorOnly
      title="โปรไฟล์และทักษะของคุณ"
      body="สร้างโปรไฟล์ทักษะครั้งเดียว แล้วให้ TOR ที่ตรงกับความสามารถของคุณวิ่งมาหาเอง พร้อมคะแนนจับคู่และเหตุผลที่ตรงกัน"
    >
      <VendorProfileView />
    </VendorOnly>
  );
}
