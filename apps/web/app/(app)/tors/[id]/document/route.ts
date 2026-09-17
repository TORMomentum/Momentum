import { proxyDocument } from "../../../../../src/shared/api/document-proxy";

type Params = { params: Promise<{ id: string }> };

async function handle(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return proxyDocument(request, `/tors/${encodeURIComponent(id)}/document`);
}

export { handle as GET, handle as HEAD };
