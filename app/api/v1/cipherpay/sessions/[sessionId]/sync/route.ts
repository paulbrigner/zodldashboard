import { proxyCipherPayViewerRequest } from "@/lib/cipherpay-test/proxy";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  return proxyCipherPayViewerRequest(request, `/cipherpay/sessions/${encodeURIComponent(sessionId)}/sync`);
}
