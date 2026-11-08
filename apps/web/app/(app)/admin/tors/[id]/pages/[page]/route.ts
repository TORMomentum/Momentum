import { proxyDocument } from "../../../../../../../src/shared/api/document-proxy";
import { isStaff } from "../../../../../../../src/shared/lib/staff-session";

type Params = { params: Promise<{ id: string; page: string }> };

async function handle(request: Request, { params }: Params): Promise<Response> {
  // The staff session is checked BEFORE the server-held admin key is attached.
  if (!(await isStaff())) return new Response(null, { status: 404 });
  const { id, page } = await params;
  const adminKey = (process.env.ADMIN_API_KEYS ?? "").split(",")[0]?.trim() ?? "";
  return proxyDocument(request, `/admin/tors/${encodeURIComponent(id)}/pages/${encodeURIComponent(page)}`, {
    "x-api-key": adminKey,
  });
}

export { handle as GET };
