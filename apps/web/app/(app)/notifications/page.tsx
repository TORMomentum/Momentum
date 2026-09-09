import { VendorOnly } from "../../../src/features/app-shell/VendorOnly";
import { NotificationsView } from "../../../src/views/NotificationsView";

export default function NotificationsPage() {
  return (
    <VendorOnly
      title="การแจ้งเตือนของคุณ"
      body="รับอีเมลภายใน 5 นาทีหลังมี TOR ใหม่ที่ตรงกับทักษะของคุณ พร้อมเหตุผลว่าทำไมงานนี้ถึงตรงกับคุณ"
    >
      <NotificationsView />
    </VendorOnly>
  );
}
