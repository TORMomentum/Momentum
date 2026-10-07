import { proxyDocument } from "../../../../../../src/shared/api/document-proxy";
import { isStaff } from "../../../../../../src/shared/lib/staff-session";

type Params = { params: Promise<{ id: string }> };

async function handle(request: Request, { params }: Params): Promise<Response> {
  // The staff session is checked BEFORE the server-held admin key is attached.
  if (!(await isStaff())) return new Response(null, { status: 404 });
  const { id } = await params;
  const adminKey = (process.env.ADMIN_API_KEYS ?? "").split(",")[0]?.trim() ?? "";
  return proxyDocument(request, `/admin/tors/${encodeURIComponent(id)}/document`, {
    "x-api-key": adminKey,
  });
}

export { handle as GET, handle as HEAD };
