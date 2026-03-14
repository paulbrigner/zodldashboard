import { proxyCipherPayViewerRequest } from "@/lib/cipherpay-test/proxy";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return proxyCipherPayViewerRequest(request, "/cipherpay/checkout");
}
