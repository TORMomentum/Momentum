import { VendorOnly } from "../../../../src/features/app-shell/VendorOnly";
import { PathView } from "../../../../src/features/path/PathView";
import { fetchFieldPath } from "../../../../src/shared/api/path.api";

/** The target is read from the URL and the analysis on the server, so the page arrives complete. */
export default async function PathPage({ searchParams }: { searchParams: Promise<{ target?: string }> }) {
  const { target } = await searchParams;
  const result = target ? await fetchFieldPath(target) : null;
  return (
    <VendorOnly
      title="เส้นทางของบริษัท"
      body="เลือกสาขางานที่อยากขยาย แล้วดูว่า TOR ในสาขานั้นขอใบรับรองหรือทะเบียนอะไร เทียบกับโปรไฟล์ของคุณ"
    >
      <PathView target={target ?? null} result={result} />
    </VendorOnly>
  );
}
