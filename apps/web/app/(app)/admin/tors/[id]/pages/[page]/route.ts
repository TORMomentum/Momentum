import { proxyDocument } from "../../../../../../../src/shared/api/document-proxy";
import { requireStaff } from "../../../../../../../src/shared/lib/staff-session";

type Params = { params: Promise<{ id: string; page: string }> };

async function handle(request: Request, { params }: Params): Promise<Response> {
  // Only an admin account's session goes on to the API, which checks the role again (TOR-199).
  let sessionId: string;
  try {
    sessionId = await requireStaff();
  } catch {
    return new Response(null, { status: 404 });
  }
  const { id, page } = await params;
  return proxyDocument(request, `/admin/tors/${encodeURIComponent(id)}/pages/${encodeURIComponent(page)}`, {
    "x-session-id": sessionId,
  });
}

export { handle as GET };
