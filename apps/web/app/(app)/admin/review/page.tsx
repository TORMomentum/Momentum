import { AdminReviewView } from "../../../../src/views/AdminReviewView";
import { redirect } from "next/navigation";
import {
  AdminApiUnavailable,
  AdminRecordNotFound,
  fetchQueue,
  fetchRecord,
  type ReviewRecord,
} from "../../../../src/shared/lib/admin-api";
import {
  isStaff,
} from "../../../../src/shared/lib/staff-session";

/**
 * Staff-only screen (FR-G-1). The queue and the selected record are fetched on
 * the server, so the admin key never reaches the browser; the view below is a
 * client component only because it edits fields.
 */
export const dynamic = "force-dynamic";

export default async function AdminReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; reason?: string; view?: string }>;
}) {
  // Page checks protect reads; the separate checks inside Server Actions
  // protect direct mutation requests that never render this page.
  if (!(await isStaff())) redirect("/admin/login");

  const { id, reason, view: requestedView } = await searchParams;
  const view = requestedView === "fields" ? "fields" : "confidence";

  let queue: Awaited<ReturnType<typeof fetchQueue>> = { items: [], unverifiedNotQueued: 0 };
  let record: ReviewRecord | null = null;
  let documentHref: string | null = null;
  let offline: string | null = null;

  let missingRecord = false;

  try {
    queue = await fetchQueue(view === "fields" ? undefined : reason, view);
    // Opening the first item by default: a reviewer lands ready to work, and a
    // deep link from the activity log still wins.
    const requested = id ?? queue.items[0]?.id;
    let opened: string | undefined = requested;

    if (requested) {
      try {
        record = await fetchRecord(requested);
      } catch (error) {
        // A deep link can outlive the record it points at — rejected, cleared,
        // or merged since the link was made. That is not an outage, so the
        // screen says so and falls back to the queue rather than going dark.
        if (!(error instanceof AdminRecordNotFound)) throw error;
        missingRecord = true;
        opened = queue.items.find((item) => item.id !== requested)?.id;
        record = opened ? await fetchRecord(opened) : null;
      }
    }

    // No fetch: the document is streamed by the proxy route on demand, and the
    // record already carries what the panel needs to display (storage.bytes,
    // contentType) — a signed-URL round trip is no longer part of loading this
    // page (spec §5).
    if (record && opened) {
      documentHref = `/admin/tors/${opened}/document`;
    }
  } catch (error) {
    // The detail goes to the server log; the reader gets a sentence. An API
    // path and a JSON body are not something a reviewer can act on.
    console.error("[admin/review] queue load failed", error);
    offline =
      error instanceof AdminApiUnavailable
        ? "ยังไม่ได้เชื่อมต่อกับบริการข้อมูล — คิวจะปรากฏเมื่อบริการทำงาน"
        : "โหลดคิวตรวจสอบไม่สำเร็จ — ลองใหม่อีกครั้ง";
  }

  return (
    <AdminReviewView
      queue={queue.items}
      unverifiedNotQueued={queue.unverifiedNotQueued}
      fieldsToConfirm={queue.fieldsToConfirm ?? 0}
      view={view}
      record={record}
      documentHref={documentHref}
      offline={offline}
      missingRecord={missingRecord}
      activeReason={reason}
    />
  );
}
