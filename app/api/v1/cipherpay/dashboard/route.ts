import { proxyCipherPayViewerRequest } from "@/lib/cipherpay-test/proxy";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return proxyCipherPayViewerRequest(request, "/cipherpay/dashboard");
}
