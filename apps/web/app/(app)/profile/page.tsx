import { VendorOnly } from "../../../src/features/app-shell/VendorOnly";
import { VendorProfileView } from "../../../src/views/VendorProfileView";
import { fetchOwnProfile } from "../../../src/shared/api/profile.api";
import { fetchOwnBookmarks } from "../../../src/shared/api/bookmarks.api";
import { fetchOwnVault } from "../../../src/shared/api/vault.api";
import { VaultPanel } from "../../../src/features/vault/VaultPanel";
import { PathLink } from "../../../src/features/path/PathLink";

/**
 * The profile is read here, on the server, and handed down. Fetching it from
 * the browser instead meant the page rendered a loading state first and the
 * vendor's own answers arrived a round trip later.
 */
export default async function ProfilePage() {
  const [profile, bookmarks, vault] = await Promise.all([fetchOwnProfile(), fetchOwnBookmarks(), fetchOwnVault()]);
  return (
    <VendorOnly
      title="โปรไฟล์และทักษะของคุณ"
      body="สร้างโปรไฟล์ทักษะครั้งเดียว แล้วให้ TOR ที่ตรงกับความสามารถของคุณวิ่งมาหาเอง พร้อมคะแนนจับคู่และเหตุผลที่ตรงกัน"
    >
      <VendorProfileView initial={profile} bookmarks={bookmarks} />
      <VaultPanel initial={vault} />
      <PathLink />
    </VendorOnly>
  );
}
