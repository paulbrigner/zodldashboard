import {
  getAccessControlSnapshot,
  performAccessControlOperation,
  requireManageAccessPermission,
} from "@/lib/access-control";
import { resolveApiRouteViewer } from "@/lib/api-route-viewer";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";

export const runtime = "nodejs";

async function requireAdminViewer(request: Request) {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return { ok: false as const, response: jsonError("authentication required", 401) };
  }
  try {
    requireManageAccessPermission(viewer);
  } catch {
    return { ok: false as const, response: jsonError("access-control admin permission required", 403) };
  }
  return { ok: true as const, viewer };
}

export async function GET(request: Request) {
  const admin = await requireAdminViewer(request);
  if (!admin.ok) return admin.response;

  try {
    const snapshot = await getAccessControlSnapshot(admin.viewer.email);
    return jsonOk({ snapshot });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "failed to load access-control snapshot", 503);
  }
}

export async function POST(request: Request) {
  const admin = await requireAdminViewer(request);
  if (!admin.ok) return admin.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  try {
    const result = await performAccessControlOperation(admin.viewer.email, payload);
    return jsonOk(result);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "access-control operation failed", 400);
  }
}
