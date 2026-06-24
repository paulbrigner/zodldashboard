import {
  createExecutionTrackerItem,
  executionTrackerStatus,
  getExecutionTrackerState,
} from "@/lib/execution-tracker";
import { resolveApiRouteViewer } from "@/lib/api-route-viewer";
import { jsonError, jsonOk } from "@/lib/xmonitor/http";
import type { ExecutionTrackerCreatePayload } from "@/lib/execution-tracker-types";

export const runtime = "nodejs";

function stringParam(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: Request) {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }

  const url = new URL(request.url);
  const dashboardId = stringParam(url.searchParams.get("dashboard_id") || url.searchParams.get("dashboardId"));
  const boardKey = stringParam(url.searchParams.get("board_key") || url.searchParams.get("boardKey")) || "default";
  if (!dashboardId) {
    return jsonError("dashboard_id is required", 400);
  }

  try {
    const state = await getExecutionTrackerState(viewer, dashboardId, boardKey);
    return jsonOk(state);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "failed to load execution tracker",
      executionTrackerStatus(error, 503)
    );
  }
}

export async function POST(request: Request) {
  const viewer = await resolveApiRouteViewer(new URL(request.url).pathname);
  if (!viewer) {
    return jsonError("authentication required", 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const createPayload: ExecutionTrackerCreatePayload = {
    dashboardId: stringParam(body.dashboard_id || body.dashboardId),
    boardKey: stringParam(body.board_key || body.boardKey) || "default",
    title: stringParam(body.title),
    description: typeof body.description === "string" ? body.description : null,
    statusKey: stringParam(body.status_key || body.statusKey),
    assignee: typeof body.assignee === "string" ? body.assignee : null,
    dueDate: typeof (body.due_date || body.dueDate) === "string" ? String(body.due_date || body.dueDate) : null,
    labels: Array.isArray(body.labels) ? body.labels.filter((entry): entry is string => typeof entry === "string") : [],
    links: Array.isArray(body.links) ? body.links as ExecutionTrackerCreatePayload["links"] : [],
    beforeItemId: typeof (body.before_item_id || body.beforeItemId) === "string" ? String(body.before_item_id || body.beforeItemId) : null,
    afterItemId: typeof (body.after_item_id || body.afterItemId) === "string" ? String(body.after_item_id || body.afterItemId) : null,
  };
  if (!createPayload.dashboardId) {
    return jsonError("dashboard_id is required", 400);
  }

  try {
    const item = await createExecutionTrackerItem(viewer, createPayload);
    return jsonOk({ item }, 201);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "failed to create execution tracker item",
      executionTrackerStatus(error, 503)
    );
  }
}
